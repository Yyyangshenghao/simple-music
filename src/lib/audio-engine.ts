import { api, isLocalApiUrl } from './api'
import { AudioPreloadPool } from './audio-preload-pool'
import { KaraokeFilter } from './karaoke-filter'

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

export class AudioEngine {
  private audio: HTMLAudioElement
  private ctx: AudioContext | null = null
  private source: MediaElementAudioSourceNode | null = null
  private analyser: AnalyserNode | null = null
  private gain: GainNode | null = null
  /** K 歌中置消除链;首次开启才建立,之后常驻在 source 与 analyser 之间只做淡变。 */
  private karaoke: KaraokeFilter | null = null
  private karaokeOn = false
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
    listen('canplay', () => this.cbs.onCanPlay?.(this.loadId))
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
    this.source.connect(this.analyser)
    this.analyser.connect(this.gain)
    this.gain.connect(this.ctx.destination)
    if (this.karaokeOn) this.mountKaraoke().setEnabled(true, 0)
  }

  /** 把中置消除链插到 source 与 analyser 之间;频谱随之反映消除后的声音。 */
  private mountKaraoke(): KaraokeFilter {
    if (this.karaoke) return this.karaoke
    const filter = new KaraokeFilter(this.ctx!)
    filter.output.connect(this.analyser!)
    this.source?.disconnect()
    this.source?.connect(filter.input)
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
  load(upstreamUrl: string, startAt?: number, cacheKey?: string, cacheContext?: AudioCacheRequestContext, usePreloaded = false): number {
    ++this.playRevision
    this.clearPauseTimer()
    const loadId = ++this.loadId
    // 新曲从静音起步,出声时经 playing 事件淡入
    this.rampGain(0, 0)
    this.cbs.onStatus?.('loading')
    this.pendingSeek = startAt && startAt > 0 ? startAt : null
    // 本地音乐的 url 已经是我们自己的 /api/local/audio(同样支持 Range),直接播;
    // 再套一层 /api/audio 既多一跳,也会被 server 的 SSRF 防护按回环地址拦掉。
    const src = mediaUrl({ url: upstreamUrl, startAt: startAt ?? 0, cacheKey, cacheContext })
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
    this.audio.load()
    return loadId
  }

  /** 是否已加载过音频源(重启恢复态为 false,播放前需重新 load)。 */
  get hasSource(): boolean {
    return !this.retained && !!this.audio.src
  }

  clearSource(retainForPreload = false): void {
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
      this.source.connect(this.karaoke?.input ?? this.analyser)
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

  async play(): Promise<void> {
    if (this.retained) return
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
  }

  setVolume(v: number): void {
    this.audio.volume = Math.max(0, Math.min(1, v))
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
    this.karaoke?.disconnect()
    this.karaoke = null
    this.analyser?.disconnect()
    this.gain?.disconnect()
    void this.ctx?.close()
    this.ctx = null
  }
}
