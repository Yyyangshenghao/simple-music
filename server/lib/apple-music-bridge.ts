import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { ServerContext } from '../types'

export interface AppleMusicCommand {
  type: 'load' | 'play' | 'pause' | 'stop' | 'seek' | 'volume'
  playbackId: string
  id?: string
  library?: boolean
  startAt?: number
  duration?: number
  controlSequence?: number
  autoplay?: boolean
  volume?: number
  seconds?: number
}
export type AppleMusicSubscriptionState = 'unknown' | 'active' | 'inactive'
export interface AppleMusicBridgeState {
  controlSequence?: number
  connected: boolean
  playbackId: string
  status: 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error'
  position: number
  duration: number
  error?: string
  loggedIn: boolean
  subscription: AppleMusicSubscriptionState
}
interface Session {
  generation: symbol
  secret: string
  seen: number
  sequence: number
  commands: Array<AppleMusicCommand & { sequence: number }>
  state: AppleMusicBridgeState
}
const sessions = new WeakMap<ServerContext, Session>()
const TIMEOUT = 15_000
export function openAppleMusicBridge(ctx: ServerContext): string {
  sessions.set(ctx, { generation: Symbol(), secret: randomBytes(32).toString('hex'), seen: 0, sequence: 0, commands: [], state: {
    connected: false, playbackId: '', status: 'idle', position: 0, duration: 0, loggedIn: false, subscription: 'unknown'
  } })
  return `http://127.0.0.1:${ctx.port}/apple-music-player#${sessions.get(ctx)!.secret}`
}
export function hasAppleMusicSession(ctx: ServerContext, secret: unknown): boolean {
  const expected = sessions.get(ctx)?.secret
  return typeof secret === 'string' && !!expected && /^[a-f0-9]{64}$/.test(secret) && timingSafeEqual(Buffer.from(secret), Buffer.from(expected))
}
export function appleMusicBridgeState(ctx: ServerContext, now = Date.now()): AppleMusicBridgeState {
  const session = sessions.get(ctx)
  if (!session) return { connected: false, playbackId: '', status: 'idle', position: 0, duration: 0, loggedIn: false, subscription: 'unknown' }
  const connected = session.seen > 0 && now - session.seen < TIMEOUT
  if (!connected && session.seen > 0 && session.state.status !== 'idle') {
    session.state = { ...session.state, status: 'error', error: 'Apple Music 播放窗口已断开，请重新连接' }
    session.commands = []
  }
  return { ...session.state, connected }
}
export function queueAppleMusicCommand(ctx: ServerContext, value: AppleMusicCommand): void {
  const s = sessions.get(ctx)
  if (!s) throw new Error('请先连接 Apple Music 播放窗口')
  if (!value || !['load', 'play', 'pause', 'stop', 'seek', 'volume'].includes(value.type) || typeof value.playbackId !== 'string' || value.playbackId.length > 256) throw new Error('无效播放指令')
  if (value.type === 'load' && (typeof value.id !== 'string' || !/^[\w.-]{1,256}$/.test(value.id))) throw new Error('无效歌曲编号')
  for (const key of ['startAt', 'seconds', 'volume', 'duration'] as const) {
    if (value[key] !== undefined && (!Number.isFinite(value[key]) || value[key]! < 0 || (key === 'volume' && value[key]! > 1))) throw new Error('无效播放参数')
  }
  if (value.controlSequence !== undefined && (!Number.isSafeInteger(value.controlSequence) || value.controlSequence < 0)) throw new Error('无效播放参数')
  if (value.type === 'load' || value.type === 'play') {
    if (s.state.subscription === 'inactive') throw new Error('此 Apple 账号没有有效的 Apple Music 订阅，无法播放完整歌曲')
    if (s.state.subscription !== 'active') throw new Error('暂时无法确认 Apple Music 订阅状态，请检查网络后重试')
  }
  if (value.type === 'load') {
    s.commands = []
    s.state = { ...s.state, playbackId: value.playbackId, status: 'loading', position: 0, duration: 0, controlSequence: 0, error: undefined }
  } else if (value.playbackId !== s.state.playbackId) return
  if (s.commands.length >= 100) throw new Error('播放窗口未响应，请重新连接')
  s.commands.push({ ...value, sequence: ++s.sequence })
}
export function pollAppleMusicCommands(ctx: ServerContext, ack: number, now = Date.now()) {
  const s = sessions.get(ctx)!
  // A resumed stale tab must not resume queued playback after disconnection.
  if (s.seen && now - s.seen >= TIMEOUT) {
    s.commands = [{ type: 'stop', playbackId: s.state.playbackId, sequence: ++s.sequence }]
  }
  s.seen = now
  s.commands = s.commands.filter(c => c.sequence > ack)
  return s.commands
}
export function updateAppleMusicBridgeState(ctx: ServerContext, state: Partial<AppleMusicBridgeState>): void {
  const s = sessions.get(ctx)!
  if (state.playbackId !== s.state.playbackId) return
  const status = ['idle', 'loading', 'playing', 'paused', 'ended', 'error'].includes(state.status ?? '') ? state.status! : s.state.status
  const subscription = ['unknown', 'active', 'inactive'].includes(state.subscription ?? '') ? state.subscription! : s.state.subscription
  s.state = { ...s.state, status, position: Number.isFinite(state.position) && state.position! >= 0 ? state.position! : s.state.position,
    controlSequence: Number.isSafeInteger(state.controlSequence) && state.controlSequence! >= 0 ? state.controlSequence : s.state.controlSequence,
    duration: Number.isFinite(state.duration) && state.duration! >= 0 ? state.duration! : s.state.duration,
    error: typeof state.error === 'string' ? state.error.slice(0, 500) : undefined, subscription }
}
export function setAppleMusicBridgeLoggedIn(ctx: ServerContext, loggedIn: boolean) {
  const s = sessions.get(ctx)
  if (s) s.state = { ...s.state, loggedIn, ...(!loggedIn ? { subscription: 'unknown' as const } : {}) }
}

export function revokeAppleMusicBridge(ctx: ServerContext): void {
  sessions.delete(ctx)
}

/** Internal generation marker for discarding authentication failures from an older window. */
export function getAppleMusicBridgeGeneration(ctx: ServerContext): symbol | undefined {
  return sessions.get(ctx)?.generation
}
