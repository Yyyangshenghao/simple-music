import { api, isLocalApiUrl } from './api'

export type PlaybackStatus = 'idle' | 'loading' | 'playing' | 'paused'

export interface AudioEngineCallbacks {
  onPosition?: (seconds: number) => void
  onDuration?: (seconds: number) => void
  onEnded?: () => void
  onStatus?: (status: PlaybackStatus) => void
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
  private freq: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(0))
  private cbs: AudioEngineCallbacks
  /** load 指定的起播位置;元数据就绪后再应用(过早设 currentTime 会被忽略)。 */
  private pendingSeek: number | null = null
  /** 淡出后真正暂停元素的定时器;play/load 需取消,避免淡出期间恢复播放又被暂停。 */
  private pauseTimer: ReturnType<typeof setTimeout> | null = null

  constructor(cbs: AudioEngineCallbacks = {}) {
    this.cbs = cbs
    this.audio = new Audio()
    this.audio.crossOrigin = 'anonymous'
    this.audio.preload = 'auto'
    this.bindEvents()
  }

  private bindEvents(): void {
    const a = this.audio
    a.addEventListener('timeupdate', () => this.cbs.onPosition?.(a.currentTime))
    a.addEventListener('durationchange', () => {
      if (Number.isFinite(a.duration)) this.cbs.onDuration?.(a.duration)
    })
    a.addEventListener('ended', () => {
      this.cbs.onStatus?.('paused')
      this.cbs.onEnded?.()
    })
    a.addEventListener('playing', () => {
      // 起播/恢复统一在此淡入:load 时 gain 已归零,出声瞬间从 0 拉起
      this.rampGain(1, FADE_SEC)
      this.cbs.onStatus?.('playing')
    })
    a.addEventListener('pause', () => {
      if (!a.ended) this.cbs.onStatus?.('paused')
    })
    a.addEventListener('waiting', () => this.cbs.onStatus?.('loading'))
    a.addEventListener('loadedmetadata', () => {
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
    this.analyser = this.ctx.createAnalyser()
    this.analyser.fftSize = 2048
    this.freq = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount))
    this.gain = this.ctx.createGain()
    this.source.connect(this.analyser)
    this.analyser.connect(this.gain)
    this.gain.connect(this.ctx.destination)
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
  load(upstreamUrl: string, startAt?: number, cacheKey?: string): void {
    this.clearPauseTimer()
    // 新曲从静音起步,出声时经 playing 事件淡入
    this.rampGain(0, 0)
    this.cbs.onStatus?.('loading')
    this.pendingSeek = startAt && startAt > 0 ? startAt : null
    // 本地音乐的 url 已经是我们自己的 /api/local/audio(同样支持 Range),直接播;
    // 再套一层 /api/audio 既多一跳,也会被 server 的 SSRF 防护按回环地址拦掉。
    const src =
      /^https?:\/\//i.test(upstreamUrl) && !isLocalApiUrl(upstreamUrl)
        ? api.url('/api/audio', cacheKey ? { url: upstreamUrl, cacheKey } : { url: upstreamUrl })
        : upstreamUrl
    this.audio.src = src
    this.audio.load()
  }

  /** 是否已加载过音频源(重启恢复态为 false,播放前需重新 load)。 */
  get hasSource(): boolean {
    return !!this.audio.src
  }

  async play(): Promise<void> {
    this.clearPauseTimer()
    this.ensureContext()
    if (this.ctx?.state === 'suspended') await this.ctx.resume()
    // 淡出进行中被恢复:元素未暂停不会再发 playing 事件,这里直接拉回
    if (!this.audio.paused) {
      this.rampGain(1, FADE_SEC)
      this.cbs.onStatus?.('playing')
    }
    await this.audio.play()
  }

  pause(): void {
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

  seek(seconds: number): void {
    this.audio.currentTime = Math.max(0, seconds)
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
    this.clearPauseTimer()
    this.audio.pause()
    this.audio.src = ''
    this.source?.disconnect()
    this.analyser?.disconnect()
    this.gain?.disconnect()
    void this.ctx?.close()
    this.ctx = null
  }
}
