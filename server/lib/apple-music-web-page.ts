import type { AppleMusicCommand, AppleMusicSubscriptionState } from './apple-music-bridge'

interface MusicInstance {
  isAuthorized: boolean
  storefrontId: string
  currentPlaybackTime: number
  currentPlaybackDuration: number
  playbackState: number
  volume: number
  previewOnly: boolean
  hasMusicSubscription?(): Promise<boolean>
  me?(): Promise<{ subscription?: { active?: boolean } }>
  api: { music(path: string): Promise<{ data: unknown }> }
  setQueue(queue: { song: string; startPlaying: boolean }): Promise<unknown>
  play(): Promise<void>
  pause(): Promise<void>
  stop(): Promise<void>
  seekToTime(seconds: number): Promise<void>
  addEventListener(name: string, handler: (event?: { message?: string; error?: { message?: string } }) => void): void
}
interface PageState {
  generation: number
  failures: number
  queueReady: boolean
  pausedId: string
  playbackId: string
  status: 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error'
  error?: string
  expectedDuration: number
  pendingSeek: number | null
  subscription: AppleMusicSubscriptionState
  subscriptionCheckedAt: number
  accountStorefront: string
  wasAuthorized: boolean
}
export type WebPageTask = { type: 'state' } | { type: 'catalog'; path: string }
  | { type: 'invalidate'; generation: number } | { type: 'suspend'; playbackId: string } | { type: 'command'; command: AppleMusicCommand; generation: number }

// 由应用内隔离的官网窗口执行；此函数必须自包含，不能引用主进程变量或凭据。
export async function appleMusicWebPage(task: WebPageTask) {
  if (location.origin !== 'https://music.apple.com') throw new Error('请回到 Apple Music 官网完成登录')
  const web = globalThis as unknown as {
    MusicKit?: { getInstance(): MusicInstance; Events: Record<string, string>; PlaybackStates: Record<string, number> }
    __simpleMusicSession?: PageState
  }
  const kit = web.MusicKit
  const music = kit?.getInstance()
  if (!music || !kit) throw new Error('Apple Music 官网仍在加载，请稍候')
  if (!web.__simpleMusicSession) {
    const initial: PageState = { generation: 0, failures: 0, queueReady: false, pausedId: '', playbackId: '', status: 'idle', expectedDuration: 0, pendingSeek: null,
      subscription: 'unknown', subscriptionCheckedAt: 0, accountStorefront: '', wasAuthorized: false }
    web.__simpleMusicSession = initial
    music.addEventListener(kit.Events.mediaPlaybackError, event => {
      initial.failures++
      initial.status = 'error'
      initial.error = event?.error?.message || event?.message || 'Apple Music 播放失败；请确认订阅有效，并检查浏览器播放支持'
      void Promise.resolve().then(() => music.stop()).catch(() => {})
    })
  }
  const state = web.__simpleMusicSession
  const refreshStorefront = async (): Promise<string> => {
    const current = music.storefrontId || 'cn'
    if (!music.isAuthorized) { state.accountStorefront = ''; return current }
    if (!state.accountStorefront) {
      try {
        const value = (await music.api.music('v1/me/storefront')).data as { data?: Array<{ id?: string }> }
        const id = value.data?.[0]?.id
        if (typeof id === 'string' && /^[a-z]{2}$/.test(id)) state.accountStorefront = id
      } catch { /* Keep the page storefront until Apple returns the account storefront. */ }
    }
    const account = state.accountStorefront || current
    return account
  }
  const refreshSubscription = async (force = false): Promise<AppleMusicSubscriptionState> => {
    const authorized = !!music.isAuthorized
    if (!authorized) {
      state.subscription = 'unknown'; state.subscriptionCheckedAt = 0; state.wasAuthorized = false
      return state.subscription
    }
    if (!state.wasAuthorized) {
      state.subscription = 'unknown'; state.subscriptionCheckedAt = 0; state.wasAuthorized = true
    }
    const now = Date.now()
    const maxAge = state.subscription === 'active' ? 300_000 : state.subscription === 'inactive' ? 60_000 : 15_000
    if (!force && state.subscriptionCheckedAt && now - state.subscriptionCheckedAt < maxAge) return state.subscription
    try {
      let active: boolean
      if (typeof music.hasMusicSubscription === 'function') active = await music.hasMusicSubscription()
      else if (typeof music.me === 'function') {
        const value = (await music.me()).subscription?.active
        if (typeof value !== 'boolean') throw new Error('MusicKit 未返回明确的订阅状态')
        active = value
      }
      else throw new Error('当前 MusicKit 不支持订阅状态检查')
      state.subscription = active ? 'active' : 'inactive'
    } catch {
      state.subscription = 'unknown'
    }
    state.subscriptionCheckedAt = now
    return state.subscription
  }
  const requireSubscription = async () => {
    const subscription = await refreshSubscription(state.subscription !== 'active')
    if (subscription === 'inactive') throw new Error('此 Apple 账号没有有效的 Apple Music 订阅，无法播放完整歌曲')
    if (subscription !== 'active') throw new Error('暂时无法确认 Apple Music 订阅状态，请检查网络后重试')
  }
  if (task.type === 'invalidate') { state.generation = task.generation; state.pausedId = ''; return null }
  if (task.type === 'suspend') { state.pausedId = task.playbackId; return null }
  if (task.type === 'catalog') {
    // api.music 在官网自身来源下运行，凭据不离开浏览器，也不伪造 Origin。
    return (await music.api.music(task.path.replace(/^\//, ''))).data
  }
  if (task.type === 'state') {
    const storefront = await refreshStorefront()
    const subscription = await refreshSubscription()
    const p = kit.PlaybackStates
    if (state.playbackId && state.status !== 'error' && state.status !== 'loading') {
      if (music.playbackState === p.playing) state.status = 'playing'
      else if (music.playbackState === p.paused) state.status = 'paused'
      else if (music.playbackState === p.completed || music.playbackState === p.ended) state.status = 'ended'
    }
    if (state.status === 'playing' && state.expectedDuration > 0 && music.currentPlaybackDuration > 0 && music.currentPlaybackDuration + 3 < state.expectedDuration) {
      state.status = 'error'; state.error = '检测到试听片段，已停止播放；完整歌曲需要有效的 Apple Music 订阅'
      await music.stop()
    }
    if (subscription === 'inactive' && ['loading', 'playing', 'paused'].includes(state.status)) {
      state.status = 'error'; state.error = '此 Apple 账号没有有效的 Apple Music 订阅，无法播放完整歌曲'; state.queueReady = false
      await music.stop()
    }
    return { connected: true, loggedIn: !!music.isAuthorized, subscription, storefront,
      redirectUrl: storefront !== music.storefrontId ? `https://music.apple.com/${storefront}/new` : undefined,
      playbackId: state.playbackId, status: state.status, error: state.error,
      position: state.pendingSeek ?? (music.currentPlaybackTime || 0), duration: music.currentPlaybackDuration || 0 }
  }
  const c = task.command
  if (task.generation !== state.generation) return null
  // stop 已在主进程按当前桌面 playbackId 校验；新 load 尚未执行时也必须停止旧 SDK 队列。
  if (c.type !== 'load' && c.type !== 'stop' && c.playbackId !== state.playbackId) return null
  const failures = state.failures
  const current = () => task.generation === state.generation && failures === state.failures
  const play = async () => {
    if (!current()) return
    if (!state.queueReady) throw new Error('歌曲尚未加载成功，请重新选择歌曲')
    if (state.pausedId === state.playbackId) { state.status = 'paused'; return }
    await music.play()
    if (!current()) { await music.stop(); return }
    if (state.pausedId === state.playbackId) { await music.pause(); state.status = 'paused'; return }
    if (state.pendingSeek !== null) {
      await music.seekToTime(state.pendingSeek)
      if (!current()) return
      state.pendingSeek = null
    }
    state.status = 'playing'
    state.error = undefined
  }
  try {
    if (c.type === 'load') {
      if (!music.isAuthorized) throw new Error('请先在 Apple Music 官网登录')
      await requireSubscription()
      state.playbackId = c.playbackId; state.queueReady = false; state.status = 'loading'; state.error = undefined
      state.pendingSeek = c.startAt || 0
      music.previewOnly = false
      await music.stop()
      let song = c.id!
      if (c.library) {
        const result = (await music.api.music('v1/me/library/songs/' + encodeURIComponent(song) + '/catalog')).data as { data?: Array<{ id: string }> }
        song = result.data?.[0]?.id || ''
        if (!song) throw new Error('此资料库歌曲没有 Apple Music 曲库版本')
      }
      if (!current()) return null
      const details = (await music.api.music('v1/catalog/' + music.storefrontId + '/songs/' + encodeURIComponent(song))).data as { data?: Array<{ attributes?: { durationInMillis?: number } }> }
      state.expectedDuration = (details.data?.[0]?.attributes?.durationInMillis || 0) / 1000
      if (!current()) return null
      await music.setQueue({ song, startPlaying: false })
      if (!current()) return null
      state.queueReady = true
      if (c.volume !== undefined) music.volume = c.volume
      if (c.autoplay === false) state.status = 'paused'
      else await play()
    } else if (c.type === 'play') { await requireSubscription(); state.pausedId = ''; await play() }
    else if (c.type === 'pause') { await music.pause(); state.status = 'paused' }
    else if (c.type === 'stop') {
      await music.stop()
      state.playbackId = c.playbackId; state.status = 'idle'; state.queueReady = false; state.pendingSeek = null
    }
    else if (c.type === 'seek') {
      if (state.pendingSeek !== null) state.pendingSeek = c.seconds || 0
      await music.seekToTime(c.seconds || 0)
    } else if (c.type === 'volume') music.volume = c.volume!
  } catch (error) {
    if (!current()) return null
    state.status = 'error'
    state.error = error instanceof Error ? error.message : 'Apple Music 播放失败'
    await music.stop().catch(() => {})
  }
  return null
}
