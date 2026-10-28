import { api, isLocalApiUrl } from './api'
import { AudioPreloadPool } from './audio-preload-pool'
import { KaraokeFilter } from './karaoke-filter'
import { isStemMixUrl } from './karaoke-library'
import { StemMixer } from './stem-mixer'

export type PlaybackStatus = 'idle' | 'loading' | 'playing' | 'paused'

export interface AudioCacheRequestContext {
  originSource: 'netease' | 'qq'
  originId: string
  resolvedSource: 'netease' | 'qq'
  resolvedId: string
  quality: string
}

export interface AudioPreloadRequest {
  url: string
  startAt: number
  cacheKey?: string
  cacheContext?: AudioCacheRequestContext
}

/**
 * 让实际播放和预加载使用完全一致的本地媒体地址
 *
 * @param request 上游地址及缓存参数
 */
function mediaUrl(request: AudioPreloadRequest): string {
  return /^https?:\/\//i.test(request.url) && !isLocalApiUrl(request.url)
    ? api.url('/api/audio', request.cacheKey
      ? { url: request.url, cacheKey: request.cacheKey, ...request.cacheContext }
      : { url: request.url })
    : request.url
}

export interface AudioEngineCallbacks {
  onPosition?: (seconds: number) => void
  onDuration?: (seconds: number) => void
  onEnded?: () => void
  onStatus?: (status: PlaybackStatus) => void
  onSeeking?: () => void
  onSeeked?: () => void
  /** 当前候选已进入浏览器可播放态；解析器此时才提交实际音源。 */
  onCanPlay?: (loadId: number) => void
  /** URL 非空但媒体加载/解码失败，交回解析器尝试下一候选。 */
  onError?: (reason: string | undefined, loadId: number) => void
  /** 系统音频设备列表变化；上层可重建当前播放会话以恢复默认输出。 */
  onOutputDeviceChange?: (wasPlaying: boolean) => void
}

/**
 * 渲染层音频引擎：单个 HTMLAudioElement 走 /api/audio 代理播放，
 * 通过 Web Audio AnalyserNode 暴露频谱给可视化层（对齐 index.html 实现）。
 */
/** 淡入淡出时长(秒);gain 包络挂在 analyser 之后,不影响频谱/能量读数。 */
const FADE_SEC = 0.25
const SWITCH_SEC = 0.08
/** 拖动保留比例时的平滑时长，避免增益阶跃产生爆音 */
const STEM_RAMP_SEC = 0.05

interface AlternateAudio {
  audio: HTMLAudioElement
  source: MediaElementAudioSourceNode
  gain: GainNode
}

export class AudioEngine {
  private audio: HTMLAudioElement
  private ctx: AudioContext | null = null
  private source: MediaElementAudioSourceNode | null = null
  private trackGain: GainNode | null = null
  private alternate: AlternateAudio | null = null
  private switching: { cancel(): void } | null = null
  private switchTimer: ReturnType<typeof setTimeout> | null = null
  private wantsPlaying = false
  private analyser: AnalyserNode | null = null
  private gain: GainNode | null = null
  /** K 歌中置消除链;首次开启才建立,之后常驻在 source 与 analyser 之间只做淡变。 */
  private karaoke: KaraokeFilter | null = null
  private karaokeOn = false
  /** 伴奏人声混回：每个带侧轨的媒体元素一份，比例全局共用。 */
  private stemMixers = new WeakMap<HTMLAudioElement, StemMixer>()
  private stemMix = { lead: 0, backing: 0 }
  private freq: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(0))
  private cbs: AudioEngineCallbacks
  /** load 指定的起播位置;元数据就绪后再应用(过早设 currentTime 会被忽略)。 */
  private pendingSeek: number | null = null
  /** 淡出后真正暂停元素的定时器;play/load 需取消,避免淡出期间恢复播放又被暂停。 */
  private pauseTimer: ReturnType<typeof setTimeout> | null = null
  /** 每次 load/clearSource 递增，用于上层拒绝上一地址迟到的媒体事件。 */
  private loadId = 0
  /** 上下文恢复期间，暂停、换源或更新的播放请求会取代旧播放意图。 */
  private playRevision = 0
  private preloads = new AudioPreloadPool()
  private sources = new WeakMap<HTMLAudioElement, MediaElementAudioSourceNode>()
  private bound = new WeakSet<HTMLAudioElement>()
  private acceptingEvents = true
  private retained = false
  private startAt = 0
  private readonly handleDeviceChange = (): void => {
    this.cbs.onOutputDeviceChange?.(!this.audio.paused)
  }

  constructor(cbs: AudioEngineCallbacks = {}) {
    this.cbs = cbs
    this.audio = new Audio()
    this.audio.crossOrigin = 'anonymous'
    this.audio.preload = 'auto'
    this.bindEvents()
    if (typeof navigator !== 'undefined') {
      navigator.mediaDevices?.addEventListener?.('devicechange', this.handleDeviceChange)
    }
  }

  private bindEvents(): void {
    const a = this.audio
    if (this.bound.has(a)) return
    this.bound.add(a)
    const listen = (name: string, callback: () => void) => a.addEventListener(name, () => {
      if (this.acceptingEvents && this.audio === a) callback()
    })
    listen('timeupdate', () => this.cbs.onPosition?.(a.currentTime))
    listen('durationchange', () => {
      if (Number.isFinite(a.duration)) this.cbs.onDuration?.(a.duration)
    })
    listen('ended', () => {
      this.wantsPlaying = false
      this.alternate?.audio.pause()
      this.cbs.onStatus?.('paused')
      this.cbs.onEnded?.()
    })
    listen('playing', () => {
      // 起播/恢复统一在此淡入:load 时 gain 已归零,出声瞬间从 0 拉起
      this.rampGain(1, FADE_SEC)
      this.cbs.onStatus?.('playing')
    })
    listen('pause', () => {
      if (!a.ended) this.cbs.onStatus?.('paused')
    })
    listen('waiting', () => this.cbs.onStatus?.('loading'))
    listen('seeking', () => this.cbs.onSeeking?.())
    listen('seeked', () => this.cbs.onSeeked?.())
    listen('canplay', () => { if (!this.switching) this.cbs.onCanPlay?.(this.loadId) })
    listen('error', () => {
      const code = a.error?.code
      this.cbs.onError?.(code ? `MEDIA_ERR_${code}` : 'MEDIA_LOAD_ERROR', this.loadId)
    })
    listen('loadedmetadata', () => {
      if (this.pendingSeek != null) {
        a.currentTime = this.pendingSeek
        this.pendingSeek = null
      }
    })
  }

  private ensureContext(): void {
    if (this.ctx) return
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    this.ctx = new Ctor()
    this.source = this.ctx.createMediaElementSource(this.audio)
    this.sources.set(this.audio, this.source)
    this.analyser = this.ctx.createAnalyser()
    this.analyser.fftSize = 2048
    this.freq = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount))
    this.gain = this.ctx.createGain()
    this.trackGain = this.ctx.createGain()
    this.source.connect(this.trackGain)
    this.routeStems(this.audio, this.source, this.trackGain)
    this.trackGain.connect(this.analyser)
    this.analyser.connect(this.gain)
    this.gain.connect(this.ctx.destination)
    if (this.karaokeOn) this.mountKaraoke().setEnabled(true, 0)
  }

  /**
   * 按元素当前地址接入或撤下人声混回。伴奏流的轨道增益只取前两个声道：3、4 声道是人声侧轨，
   * 经混音节点按比例加回，不能按环绕声下混进来；普通音源恢复默认下混，多声道本地文件不丢声道。
   */
  private routeStems(audio: HTMLAudioElement, source: MediaElementAudioSourceNode, gain: GainNode): void {
    let mixer = this.stemMixers.get(audio)
    if (mixer) {
      try { source.disconnect(mixer.input) } catch { /* 尚未连接 */ }
      mixer.output.disconnect()
    }
    const stems = !!this.ctx && isStemMixUrl(audio.src)
    gain.channelCountMode = stems ? 'clamped-max' : 'max'
    gain.channelInterpretation = stems ? 'discrete' : 'speakers'
    if (!stems) return
    gain.channelCount = 2
    if (!mixer) {
      mixer = new StemMixer(this.ctx!, this.stemMix.lead, this.stemMix.backing)
      this.stemMixers.set(audio, mixer)
    }
    source.connect(mixer.input)
    mixer.output.connect(gain)
  }

  /**
   * 伴奏的导唱与和声保留比例，0–1；1 即原曲中的音量。未建立音频图时记下，接入时生效
   *
   * @param lead 中置人声（主唱）
   * @param backing 两侧人声（叠轨、和声）
   */
  setStemMix(lead: number, backing: number): void {
    const clamp = (value: number) => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0
    this.stemMix = { lead: clamp(lead), backing: clamp(backing) }
    for (const audio of [this.audio, this.alternate?.audio]) {
      if (audio) this.stemMixers.get(audio)?.set(this.stemMix.lead, this.stemMix.backing, STEM_RAMP_SEC)
    }
  }

  /** 把中置消除链插到 source 与 analyser 之间;频谱随之反映消除后的声音。 */
  private mountKaraoke(): KaraokeFilter {
    if (this.karaoke) return this.karaoke
    const filter = new KaraokeFilter(this.ctx!)
    filter.output.connect(this.analyser!)
    this.trackGain?.disconnect()
    this.trackGain?.connect(filter.input)
    this.alternate?.gain.disconnect()
    this.alternate?.gain.connect(filter.input)
    this.karaoke = filter
    return filter
  }

  /** gain 包络淡变;无 Web Audio(ctx 未建立)时静默跳过,播放走直连不做淡变。 */
  private rampGain(target: number, seconds: number): void {
    if (!this.ctx || !this.gain) return
    const t = this.ctx.currentTime
    const g = this.gain.gain
    g.cancelScheduledValues(t)
    g.setValueAtTime(g.value, t)
    g.linearRampToValueAtTime(target, t + seconds)
  }

  private clearPauseTimer(): void {
    if (this.pauseTimer != null) {
      clearTimeout(this.pauseTimer)
      this.pauseTimer = null
    }
  }

  /** 加载已解析出的上游音频 URL（内部走 /api/audio 代理）；startAt 为断点续播起始秒数;
   * cacheKey 供 server 侧磁盘缓存定位(source:id:quality),不传则不缓存。 */
  load(upstreamUrl: string, startAt?: number, cacheKey?: string, cacheContext?: AudioCacheRequestContext, usePreloaded = false, seamless = false): number {
    const src = mediaUrl({ url: upstreamUrl, startAt: startAt ?? 0, cacheKey, cacheContext })
    if (seamless && this.hasSource && this.ctx && this.trackGain) return this.switchSource(src)
    this.clearAlternates()
    ++this.playRevision
    this.clearPauseTimer()
    const loadId = ++this.loadId
    // 新曲从静音起步,出声时经 playing 事件淡入
    this.rampGain(0, 0)
    this.cbs.onStatus?.('loading')
    this.pendingSeek = startAt && startAt > 0 ? startAt : null
    // 本地音乐的 url 已经是我们自己的 /api/local/audio(同样支持 Range),直接播;
    // 再套一层 /api/audio 既多一跳,也会被 server 的 SSRF 防护按回环地址拦掉。
    const prepared = usePreloaded ? this.preloads.take({ src, startAt: startAt ?? 0 }) : undefined
    this.preloads.trim()
    this.startAt = startAt ?? 0
    if (prepared || this.retained) this.replaceAudio(prepared ?? new Audio())
    this.retained = false
    this.acceptingEvents = true
    if (prepared) {
      this.pendingSeek = null
      prepared.preload = 'auto'
      // 原方案每次赋值 src 并 load 命中时保留同一元素和已完成的定位
      queueMicrotask(() => {
        if (this.loadId !== loadId || this.audio !== prepared || !this.acceptingEvents) return
        this.cbs.onDuration?.(prepared.duration)
        this.cbs.onCanPlay?.(loadId)
      })
      return loadId
    }
    this.audio.src = src
    if (this.source && this.trackGain) this.routeStems(this.audio, this.source, this.trackGain)
    this.audio.load()
    return loadId
  }

  /** 是否已加载过音频源(重启恢复态为 false,播放前需重新 load)。 */
  get hasSource(): boolean {
    return !this.retained && !!this.audio.src
  }

  clearSource(retainForPreload = false): void {
    this.clearAlternates()
    this.wantsPlaying = false
    ++this.playRevision
    this.clearPauseTimer()
    this.loadId++
    if (this.retained) return
    if (retainForPreload && this.hasSource && this.audio.readyState > 0) {
      this.acceptingEvents = false
      this.audio.pause()
      this.source?.disconnect()
      this.source = null
      this.retained = true
      this.preloads.retain(this.audio, { src: this.audio.src, startAt: this.startAt })
      this.pendingSeek = null
      return
    }
    this.audio.pause()
    this.audio.removeAttribute('src')
    this.audio.load()
    this.pendingSeek = null
  }

  /**
   * 接管暂停的准备元素 复用同一个音频图和媒体源节点
   *
   * @param audio 将成为当前播放源的媒体
   */
  private replaceAudio(audio: HTMLAudioElement): void {
    this.acceptingEvents = false
    this.source?.disconnect()
    this.trackGain?.disconnect()
    const rate = this.audio.playbackRate
    this.audio.pause()
    this.audio = audio
    audio.defaultPlaybackRate = rate
    audio.playbackRate = rate
    audio.crossOrigin = 'anonymous'
    this.bindEvents()
    if (this.ctx && this.analyser) {
      this.source = this.sources.get(audio) ?? this.ctx.createMediaElementSource(audio)
      this.sources.set(audio, this.source)
      this.trackGain = this.ctx.createGain()
      this.source.connect(this.trackGain)
      this.routeStems(audio, this.source, this.trackGain)
      this.trackGain.connect(this.karaoke?.input ?? this.analyser)
    }
  }

  /**
   * 准备刷歌前后各两首音频 普通播放不调用
   *
   * @param requests 最多四个相邻目标
   */
  preloadAudio(requests: AudioPreloadRequest[]): void {
    this.preloads.update(requests.map(request => ({ src: mediaUrl(request), startAt: request.startAt, rate: this.audio.playbackRate })))
  }

  /**
   * 等待已开始的预加载 不触发实际播放
   *
   * @param request 待切换的音频目标
   */
  waitForPreload(request: AudioPreloadRequest): Promise<boolean> {
    return this.preloads.wait({ src: mediaUrl(request), startAt: request.startAt })
  }

  /** 退出刷歌或账号变化时释放准备实例 */
  releasePreloads(): void { this.preloads.clear() }

  /** 只保留一条候选轨；提前获取本地伴奏，首次点按不再从零加载。 */
  prepareAlternate(url: string): void {
    if (!this.ctx || !this.analyser || this.switching || this.switchTimer) return
    const src = mediaUrl({ url, startAt: this.position })
    if (src === this.audio.src || src === this.alternate?.audio.src) return
    this.releaseAlternate()
    const audio = new Audio()
    audio.crossOrigin = 'anonymous'
    audio.preload = 'auto'
    audio.volume = this.audio.volume
    audio.defaultPlaybackRate = this.audio.playbackRate
    audio.playbackRate = this.audio.playbackRate
    const source = this.ctx.createMediaElementSource(audio)
    this.sources.set(audio, source)
    const gain = this.ctx.createGain()
    gain.gain.setValueAtTime(0, this.ctx.currentTime)
    source.connect(gain)
    gain.connect(this.karaoke?.input ?? this.analyser)
    this.alternate = { audio, source, gain }
    audio.src = src
    this.routeStems(audio, source, gain)
    audio.addEventListener('loadedmetadata', () => {
      if (this.alternate?.audio === audio && !this.switching) audio.currentTime = this.position
    }, { once: true })
    audio.load()
  }

  private releaseAlternate(): void {
    const alternate = this.alternate
    this.alternate = null
    if (!alternate) return
    alternate.audio.pause()
    alternate.audio.removeAttribute('src')
    alternate.audio.load()
    alternate.source.disconnect()
    alternate.gain.disconnect()
  }

  private clearAlternates(): void {
    this.switching?.cancel()
    if (this.switchTimer) clearTimeout(this.switchTimer)
    this.switchTimer = null
    this.releaseAlternate()
    if (this.ctx && this.trackGain) {
      this.trackGain.gain.cancelScheduledValues(this.ctx.currentTime)
      this.trackGain.gain.setValueAtTime(1, this.ctx.currentTime)
    }
  }

  /** 当前轨持续出声，目标轨定位并静音起播后才交接；两轨相关，使用线性互补增益。 */
  private switchSource(src: string, id = ++this.loadId): number {
    if (this.wantsPlaying) this.clearPauseTimer()
    this.switching?.cancel()
    if (this.switchTimer) {
      // 上次淡变完成后再响应反向切换，避免截断尾音或突然把半音量拉满。
      const timer = setTimeout(() => {
        this.switching = null
        this.switchSource(src, id)
      }, SWITCH_SEC * 1000)
      this.switching = { cancel: () => { clearTimeout(timer); this.switching = null } }
      return id
    }
    this.alternate?.audio.pause()
    this.trackGain!.gain.cancelScheduledValues(this.ctx!.currentTime)
    this.trackGain!.gain.setValueAtTime(1, this.ctx!.currentTime)
    if (src === this.audio.src) {
      this.releaseAlternate()
      queueMicrotask(() => {
        if (this.loadId !== id) return
        this.cbs.onCanPlay?.(id)
        this.cbs.onStatus?.(this.wantsPlaying ? 'playing' : 'paused')
      })
      return id
    }
    this.prepareAlternate(src)
    const next = this.alternate!
    const old = this.audio
    let busy = false
    const events = ['loadedmetadata', 'canplay', 'seeked', 'playing']
    const cleanup = () => {
      clearTimeout(timeout)
      for (const name of events) next.audio.removeEventListener(name, check)
      next.audio.removeEventListener('error', fail)
      this.switching = null
    }
    const fail = () => {
      cleanup()
      this.releaseAlternate()
      this.cbs.onError?.('MEDIA_SWITCH_FAILED', id)
    }
    const commit = () => {
      cleanup()
      const t = this.ctx!.currentTime
      const outgoing = { audio: old, source: this.source!, gain: this.trackGain! }
      this.audio = next.audio
      this.source = next.source
      this.trackGain = next.gain
      this.alternate = outgoing
      this.bindEvents()
      const duration = this.wantsPlaying ? SWITCH_SEC : 0
      for (const [node, from, to] of [[outgoing.gain, 1, 0], [next.gain, 0, 1]] as const) {
        node.gain.cancelScheduledValues(t)
        node.gain.setValueAtTime(from, t)
        node.gain.linearRampToValueAtTime(to, t + duration)
      }
      this.switchTimer = setTimeout(() => {
        this.switchTimer = null
        outgoing.audio.pause()
      }, duration * 1000)
      this.cbs.onPosition?.(this.position)
      this.cbs.onDuration?.(this.duration)
      this.cbs.onCanPlay?.(id)
      this.cbs.onStatus?.(this.wantsPlaying ? 'playing' : 'paused')
    }
    const check = async () => {
      if (busy || this.switching !== operation || next.audio.readyState < 3 || next.audio.seeking) return
      busy = true
      try {
        if (this.wantsPlaying && next.audio.paused) {
          // 先静音起播，再校正持续运行的两条时钟；暂停目标反复 seek 会永远追不上原轨。
          next.audio.currentTime = old.currentTime
          await next.audio.play()
        }
        if (this.switching !== operation) return
        if (!this.wantsPlaying) next.audio.pause()
        if (next.audio.seeking) return
        // 使用连续媒体时钟，不能用 timeupdate 对应的界面秒数。
        if (Math.abs(next.audio.currentTime - old.currentTime) > 0.002) {
          busy = false
          next.audio.currentTime = old.currentTime
          return
        }
        commit()
      } catch { if (this.switching === operation) fail() }
      finally { busy = false }
    }
    const timeout = setTimeout(fail, 5000)
    const operation = { cancel: () => { cleanup(); this.releaseAlternate() } }
    this.switching = operation
    for (const name of events) next.audio.addEventListener(name, check)
    next.audio.addEventListener('error', fail)
    queueMicrotask(() => { void check() })
    return id
  }

  async play(): Promise<void> {
    if (this.retained) return
    this.wantsPlaying = true
    const revision = ++this.playRevision
    this.clearPauseTimer()
    this.ensureContext()
    if (this.ctx?.state === 'suspended') await this.ctx.resume()
    if (revision !== this.playRevision) return
    // 淡出进行中被恢复:元素未暂停不会再发 playing 事件,这里直接拉回
    if (!this.audio.paused) {
      this.rampGain(1, FADE_SEC)
      this.cbs.onStatus?.('playing')
    }
    await this.audio.play()
  }

  pause(): void {
    this.wantsPlaying = false
    this.alternate?.audio.pause()
    ++this.playRevision
    // 无 Web Audio 或本就暂停:直接暂停,不做包络
    if (!this.ctx || !this.gain || this.audio.paused) {
      this.audio.pause()
      return
    }
    this.rampGain(0, FADE_SEC)
    // UI 立即进入暂停态,元素在淡出完成后才真正暂停
    this.cbs.onStatus?.('paused')
    this.clearPauseTimer()
    this.pauseTimer = setTimeout(() => {
      this.pauseTimer = null
      this.audio.pause()
    }, FADE_SEC * 1000)
  }

  /** 播放速度(保留音高);defaultPlaybackRate 一并设置,换曲加载后仍生效。 */
  setPlaybackRate(rate: number): void {
    this.audio.defaultPlaybackRate = rate
    this.audio.playbackRate = rate
    if (this.alternate) {
      this.alternate.audio.defaultPlaybackRate = rate
      this.alternate.audio.playbackRate = rate
    }
  }

  /** K 歌开关:消除居中人声;上下文尚未建立时记下,首次播放建图时生效。 */
  setKaraoke(on: boolean): void {
    this.karaokeOn = on
    if (!this.ctx || !this.analyser || (!on && !this.karaoke)) return
    this.mountKaraoke().setEnabled(on, FADE_SEC)
  }

  seek(seconds: number): void {
    const target = Math.max(0, seconds)
    if (this.audio.readyState === 0) {
      this.pendingSeek = target
      return
    }
    this.audio.currentTime = target
    if (this.switchTimer && this.alternate) this.alternate.audio.currentTime = target
  }

  setVolume(v: number): void {
    this.audio.volume = Math.max(0, Math.min(1, v))
    if (this.alternate) this.alternate.audio.volume = this.audio.volume
  }

  /** 返回当前频谱（0-255）。供可视化层每帧读取。 */
  getFrequencyData(): Uint8Array {
    if (this.analyser) this.analyser.getByteFrequencyData(this.freq)
    return this.freq
  }

  get duration(): number {
    return Number.isFinite(this.audio.duration) ? this.audio.duration : 0
  }

  get position(): number {
    return this.audio.currentTime
  }

  destroy(): void {
    this.clearAlternates()
    ++this.playRevision
    this.acceptingEvents = false
    this.preloads.clear()
    this.clearPauseTimer()
    if (typeof navigator !== 'undefined') {
      navigator.mediaDevices?.removeEventListener?.('devicechange', this.handleDeviceChange)
    }
    this.audio.pause()
    this.audio.src = ''
    this.source?.disconnect()
    this.trackGain?.disconnect()
    this.karaoke?.disconnect()
    this.karaoke = null
    this.analyser?.disconnect()
    this.gain?.disconnect()
    void this.ctx?.close()
    this.ctx = null
  }
}
