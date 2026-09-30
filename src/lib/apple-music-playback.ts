import { api } from './api'
import { AppleLyricClock } from './apple-lyric-clock'

export interface ApplePlaybackState {
  connected: boolean
  loggedIn: boolean
  subscription: 'unknown' | 'active' | 'inactive'
  playbackId: string
  status: 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error'
  position: number
  duration: number
  error?: string
  controlSequence?: number
}

export interface ApplePlaybackCommand {
  type: 'load' | 'play' | 'pause' | 'stop' | 'seek' | 'volume'
  playbackId: string
  id?: string
  library?: boolean
  startAt?: number
  duration?: number
  autoplay?: boolean
  volume?: number
  seconds?: number
  controlSequence?: number
}

export async function openAppleMusicPlayer(mode: 'web' | 'developer' = 'web'): Promise<void> {
  const result = await api.post<{ opened: true } | { url: string }>('/api/apple-music/bridge/open', { mode }, undefined, { timeoutMs: 60_000 })
  if ('opened' in result && result.opened) return
  if (!('url' in result) || !result.url) throw new Error('Apple Music 登录窗口未能打开，请重试')
  // Electron 的 window-open handler 会通过系统浏览器打开，不向外部页暴露 preload。
  window.open(result.url, '_blank', 'noopener,noreferrer')
}

/** 串行发送控制，避免快速暂停/切歌时晚到的 load 重新开播。 */
let commandTail: Promise<unknown> = Promise.resolve()

export class AppleMusicPlayback {
  private readonly lyricClock = new AppleLyricClock()
  get lyricPosition(): number { return this.lyricClock.read() }

  private generation = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  private playbackId = ''
  private pollFailures = 0
  private controlRevision = 0
  private pendingStatus?: { value: 'playing' | 'paused'; sequence: number }
  private pendingSeek?: { value: number; sequence: number }
  private queuedControls = new Map<string, symbol>()

  constructor(private readonly onState: (state: ApplePlaybackState) => void) {}

  command(command: Omit<ApplePlaybackCommand, 'playbackId'>): Promise<void> {
    if (command.type === 'pause' || command.type === 'stop') this.lyricClock.reset(this.lyricPosition, false)
    if (command.type === 'seek') this.lyricClock.reset(command.seconds ?? 0, false)
    const generation = this.generation
    const controlsState = ['play', 'pause', 'seek'].includes(command.type)
    const revision = controlsState ? ++this.controlRevision : this.controlRevision
    const replaceable = command.type === 'volume' || command.type === 'seek'
    const queued = Symbol()
    if (replaceable) this.queuedControls.set(command.type, queued)
    const payload = { ...command, playbackId: this.playbackId, ...(controlsState ? { controlSequence: revision } : {}) }
    if (command.type === 'play' || command.type === 'pause') {
      this.pendingStatus = { value: command.type === 'play' ? 'playing' : 'paused', sequence: revision }
    } else if (command.type === 'seek') this.pendingSeek = { value: command.seconds ?? 0, sequence: revision }
    const next = commandTail.catch(() => {}).then(async () => {
      if (command.type !== 'stop' && generation !== this.generation) return
      if (replaceable) {
        if (this.queuedControls.get(command.type) !== queued) return
        this.queuedControls.delete(command.type)
      }
      await api.post('/api/apple-music/bridge/command', payload)
    }).catch(error => {
      if (generation === this.generation && controlsState) {
        if (this.pendingStatus?.sequence === revision) this.pendingStatus = undefined
        if (this.pendingSeek?.sequence === revision) this.pendingSeek = undefined
      }
      throw error
    })
    commandTail = next
    return next
  }

  async load(id: string, library: boolean, startAt: number, autoplay: boolean, volume: number, duration?: number): Promise<void> {
    const generation = ++this.generation
    this.lyricClock.reset(startAt, false, duration ?? 0)
    clearTimeout(this.timer)
    this.playbackId = crypto.randomUUID()
    this.pollFailures = 0
    this.controlRevision = 0
    this.pendingStatus = undefined
    this.pendingSeek = undefined
    await this.command({ type: 'load', id, library, startAt, autoplay, volume, ...(duration && duration > 0 ? { duration } : {}) })
    if (generation !== this.generation) return
    void this.poll(generation)
  }

  stop(): void {
    this.lyricClock.reset(this.lyricPosition, false)
    ++this.generation
    clearTimeout(this.timer)
    if (this.playbackId) void this.command({ type: 'stop' }).catch(() => {})
    this.playbackId = ''
  }

  private async poll(generation: number): Promise<void> {
    const revision = this.controlRevision
    let delay = 250
    try {
      const state = await api.get<ApplePlaybackState>('/api/apple-music/bridge/state', undefined, { timeoutMs: 3000 })
      if (generation !== this.generation) return
      if (revision !== this.controlRevision) return
      if (!state.connected) {
        if (++this.pollFailures < 3) { delay = 750; return }
        this.onState({ ...state, playbackId: this.playbackId, status: 'error', error: (state.playbackId === this.playbackId && state.error) || 'Apple Music 应用内播放器已断开，请在设置中重新连接' })
        ++this.generation
        return
      }
      this.pollFailures = 0
      if (state.playbackId === this.playbackId) {
        const confirmed = state.controlSequence ?? 0
        if (this.pendingStatus && confirmed >= this.pendingStatus.sequence) this.pendingStatus = undefined
        if (this.pendingSeek && confirmed >= this.pendingSeek.sequence) this.pendingSeek = undefined
        if (state.status === 'error' || (state.status === 'ended' && !this.pendingStatus && !this.pendingSeek)) {
          ++this.generation
          this.onState(state)
          return
        }
        // 命令接口只确认入队；后台确认前保留用户意图，避免旧快照使按钮/进度回跳。
        const visibleState: ApplePlaybackState = { ...state,
          ...(state.status === 'ended' ? { status: 'loading' } : {}),
          ...(this.pendingStatus ? { status: this.pendingStatus.value === 'playing' ? 'loading' : 'paused' } : {}),
          ...(this.pendingSeek ? { position: this.pendingSeek.value } : {}),
        }
        this.lyricClock.update(visibleState.position, visibleState.status === 'playing' && !this.pendingSeek, visibleState.duration)
        this.onState(visibleState)
        if (state.status === 'paused' && !this.pendingStatus && !this.pendingSeek) delay = 750
      }
    } catch {
      if (generation !== this.generation) return
      if (revision !== this.controlRevision) return
      if (++this.pollFailures < 3) { delay = 750; return }
      ++this.generation
      this.onState({ connected: false, loggedIn: false, subscription: 'unknown', playbackId: this.playbackId, status: 'error', position: 0, duration: 0, error: 'Apple Music 应用内播放连接失败，请重新连接' })
    } finally {
      if (generation === this.generation) this.timer = setTimeout(() => void this.poll(generation), delay)
    }
  }
}
