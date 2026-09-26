import { api } from './api'

export interface ApplePlaybackState {
  connected: boolean
  loggedIn: boolean
  subscription: 'unknown' | 'active' | 'inactive'
  playbackId: string
  status: 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error'
  position: number
  duration: number
  error?: string
}

export interface ApplePlaybackCommand {
  type: 'load' | 'play' | 'pause' | 'stop' | 'seek' | 'volume'
  playbackId: string
  id?: string
  library?: boolean
  startAt?: number
  autoplay?: boolean
  volume?: number
  seconds?: number
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
  private generation = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  private playbackId = ''

  constructor(private readonly onState: (state: ApplePlaybackState) => void) {}

  command(command: Omit<ApplePlaybackCommand, 'playbackId'>): Promise<void> {
    const payload = { ...command, playbackId: this.playbackId }
    const generation = this.generation
    const next = commandTail.catch(() => {}).then(async () => {
      if (command.type !== 'stop' && generation !== this.generation) return
      await api.post('/api/apple-music/bridge/command', payload)
    })
    commandTail = next
    return next
  }

  async load(id: string, library: boolean, startAt: number, autoplay: boolean, volume: number): Promise<void> {
    const generation = ++this.generation
    clearTimeout(this.timer)
    this.playbackId = crypto.randomUUID()
    await this.command({ type: 'load', id, library, startAt, autoplay, volume })
    if (generation !== this.generation) return
    void this.poll(generation)
  }

  stop(): void {
    ++this.generation
    clearTimeout(this.timer)
    if (this.playbackId) void this.command({ type: 'stop' }).catch(() => {})
    this.playbackId = ''
  }

  private async poll(generation: number): Promise<void> {
    try {
      const state = await api.get<ApplePlaybackState>('/api/apple-music/bridge/state')
      if (generation !== this.generation) return
      if (!state.connected) {
        this.onState({ ...state, playbackId: this.playbackId, status: 'error', error: 'Apple Music 应用内播放器已断开，请在设置中重新连接' })
        return
      }
      if (state.playbackId === this.playbackId) {
        this.onState(state)
        if (state.status === 'ended' || state.status === 'error') return
      }
    } catch {
      if (generation !== this.generation) return
      this.onState({ connected: false, loggedIn: false, subscription: 'unknown', playbackId: this.playbackId, status: 'error', position: 0, duration: 0, error: 'Apple Music 应用内播放连接失败，请重新连接' })
      return
    }
    if (generation === this.generation) this.timer = setTimeout(() => void this.poll(generation), 750)
  }
}
