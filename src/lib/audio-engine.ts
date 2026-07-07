import { api } from './api'

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
export class AudioEngine {
  private audio: HTMLAudioElement
  private ctx: AudioContext | null = null
  private source: MediaElementAudioSourceNode | null = null
  private analyser: AnalyserNode | null = null
  private freq: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(0))
  private cbs: AudioEngineCallbacks
  /** load 指定的起播位置;元数据就绪后再应用(过早设 currentTime 会被忽略)。 */
  private pendingSeek: number | null = null

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
    a.addEventListener('playing', () => this.cbs.onStatus?.('playing'))
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
    this.source.connect(this.analyser)
    this.analyser.connect(this.ctx.destination)
  }

  /** 加载已解析出的上游音频 URL（内部走 /api/audio 代理）；startAt 为断点续播起始秒数。 */
  load(upstreamUrl: string, startAt?: number): void {
    this.cbs.onStatus?.('loading')
    this.pendingSeek = startAt && startAt > 0 ? startAt : null
    const src = /^https?:\/\//i.test(upstreamUrl) ? api.url('/api/audio', { url: upstreamUrl }) : upstreamUrl
    this.audio.src = src
    this.audio.load()
  }

  /** 是否已加载过音频源(重启恢复态为 false,播放前需重新 load)。 */
  get hasSource(): boolean {
    return !!this.audio.src
  }

  async play(): Promise<void> {
    this.ensureContext()
    if (this.ctx?.state === 'suspended') await this.ctx.resume()
    await this.audio.play()
  }

  pause(): void {
    this.audio.pause()
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
    this.audio.pause()
    this.audio.src = ''
    this.source?.disconnect()
    this.analyser?.disconnect()
    void this.ctx?.close()
    this.ctx = null
  }
}
