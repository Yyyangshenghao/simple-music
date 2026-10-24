import { afterEach, expect, it, vi } from 'vitest'
import type { Track } from '../types/domain'
import type { GameModeState, LyricsPayload, WallpaperPayload } from '../types/ipc'

let stopRuntime: (() => void) | undefined
const anonymousApple = { loginMode: 'web', configured: false, ready: true, managed: false, connected: false, loggedIn: false, subscription: 'unknown', storefront: 'cn' }

function mockLocalLyrics(api: typeof import('./api').api, lyric: string) {
  const get = api.get
  const request = vi.fn(async (..._args: Parameters<typeof api.get>) => ({ lyric }))
  vi.spyOn(api, 'get').mockImplementation((...args) => args[0] === '/api/local/lyric' ? request(...args) : get(...args))
  return request
}
afterEach(() => {
  stopRuntime?.()
  vi.restoreAllMocks()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function runtimeWithPendingGameMode(downloads?: string, accounts: Record<string, object> = {}) {
  vi.resetModules()
  vi.useFakeTimers()
  const settings = JSON.stringify({ globalHotkeysEnabled: false, miniPlayerEnabled: true, miniPlayerWidth: 360 })
  vi.stubGlobal('localStorage', { getItem: (key: string) => key === 'simplemusic-settings' ? settings : key === 'simplemusic-download-queue' ? downloads ?? null : null, setItem: vi.fn() })
  let resolve!: (state: GameModeState) => void
  let notify!: (state: GameModeState) => void
  let control!: (payload: { action: string }) => void
  const enableMini = vi.fn(async () => ({ ok: true }))
  const mini = vi.fn(async () => ({ ok: true }))
  const wallpaper = vi.fn(async (_payload: WallpaperPayload) => ({ ok: true }))
  const lyrics = vi.fn(async (_payload: LyricsPayload) => ({ ok: true }))
  const enableLyrics = vi.fn(async (_enabled: boolean, _payload: LyricsPayload) => ({ ok: true }))
  let enabledState!: (state: { enabled: boolean; requested?: boolean }) => void
  let lockState!: (state: { locked: boolean }) => void
  let sizeState!: (state: { size: number }) => void
  const stopLyricsEvents = { enabled: vi.fn(), lock: vi.fn(), size: vi.fn() }
  vi.stubGlobal('window', {
    desktop: {
      updateMiniPlayer: mini, setMiniPlayerEnabled: enableMini, onMiniPlayerWidthChanged: () => vi.fn(),
      updateWallpaper: wallpaper,
      onGameModeChange: (callback: typeof notify) => { notify = callback; return vi.fn() },
      getGameMode: () => new Promise<GameModeState>(done => { resolve = done }),
      onMiniPlayerControl: (callback: typeof control) => { control = callback; return vi.fn() },
      updateDesktopLyrics: lyrics, setDesktopLyricsEnabled: enableLyrics,
      onDesktopLyricsEnabledState: (callback: typeof enabledState) => { enabledState = callback; return stopLyricsEvents.enabled },
      onDesktopLyricsLockState: (callback: typeof lockState) => { lockState = callback; return stopLyricsEvents.lock },
      onDesktopLyricsSizeState: (callback: typeof sizeState) => { sizeState = callback; return stopLyricsEvents.size },
      configureHotkeys: async () => ({ ok: true, results: [] }), onHotkey: () => vi.fn(), onFlushListeningReports: () => vi.fn()
    },
    addEventListener: vi.fn(), removeEventListener: vi.fn()
  })
  vi.stubGlobal('navigator', {})
  const accountFetch = vi.fn(async (input: string) => {
    const path = new URL(input, 'http://127.0.0.1').pathname
    return new Response(JSON.stringify(accounts[path] ?? (path === '/api/apple-music/status' ? anonymousApple : { loggedIn: false })))
  })
  vi.stubGlobal('fetch', accountFetch)
  const { startPlaybackRuntime } = await import('./playback-runtime')
  stopRuntime = startPlaybackRuntime()
  for (let i = 0; i < 20; i++) await Promise.resolve()
  const { useGameModeStore } = await import('../stores/game-mode')
  const { useSettingsStore } = await import('../stores/settings')
  return { resolve, notify, control, mini, enableMini, wallpaper, useGameModeStore, useSettingsStore, accountFetch,
    lyrics, enableLyrics, enabledState, lockState, sizeState, stopLyricsEvents }
}

it('无React时核实留存账号并更新真实Provider，重复启动不重查，游戏暂停轮询且停止无残留', async () => {
  const h = await runtimeWithPendingGameMode(undefined, {
    '/api/login/status': { loggedIn: true, nickname: '留存网易', avatar: 'netease-avatar' },
    '/api/qq/login/status': { loggedIn: true, nickname: '留存QQ', avatar: 'qq-avatar' }
  })
  const { useProviderStore } = await import('../stores/providers')
  expect(useProviderStore.getState().byId).toMatchObject({
    netease: { auth: 'authenticated', profile: { nickname: '留存网易' } },
    qq: { auth: 'authenticated', profile: { nickname: '留存QQ' } },
    apple: { auth: 'anonymous' }
  })
  expect(h.useSettingsStore.getState()).toMatchObject({ neteaseLoggedIn: true, qqLoggedIn: true })
  const { startPlaybackRuntime } = await import('./playback-runtime')
  expect(startPlaybackRuntime()).toBe(stopRuntime)
  // 登录就绪会追加刷歌预热 此处仅统计账号核实请求
  const accountRequests = () => h.accountFetch.mock.calls.filter(([input]) =>
    ['/api/login/status', '/api/qq/login/status', '/api/apple-music/status'].includes(new URL(input, 'http://127.0.0.1').pathname))
  expect(accountRequests()).toHaveLength(3)
  const { useShuangeStore } = await import('../stores/shuange')
  const { usePlayerStore } = await import('../stores/player')
  expect(useShuangeStore.getState().active).toBe(false)
  expect(usePlayerStore.getState().currentTrack).toBeNull()
  await vi.advanceTimersByTimeAsync(3000)
  expect(accountRequests()).toHaveLength(4)
  h.notify({ enabled: true })
  await vi.advanceTimersByTimeAsync(6000)
  expect(accountRequests()).toHaveLength(4)
  h.notify({ enabled: false })
  for (let i = 0; i < 20; i++) await Promise.resolve()
  expect(accountRequests()).toHaveLength(5)
  stopRuntime!()
  await vi.advanceTimersByTimeAsync(6000)
  expect(accountRequests()).toHaveLength(5)
  expect(vi.getTimerCount()).toBe(0)
})

it('宿主停止取消睡眠倒计时，退出后的旧时钟不再尝试暂停已释放的播放器', async () => {
  await runtimeWithPendingGameMode()
  const { useSleepTimerStore } = await import('../stores/sleep-timer')
  const { usePlayerStore } = await import('../stores/player')
  const pause = vi.spyOn(usePlayerStore.getState(), 'pause')
  useSleepTimerStore.getState().start(10)
  expect(useSleepTimerStore.getState().phase).toBe('counting')
  stopRuntime!()
  expect(useSleepTimerStore.getState()).toMatchObject({ phase: 'idle', endAt: null, remainingSec: 0 })
  expect(vi.getTimerCount()).toBe(0)
  await vi.advanceTimersByTimeAsync(60 * 60_000)
  expect(pause).not.toHaveBeenCalled()
})

it('播放宿主无React时恢复下载队列，重复启动不覆盖，退出中止请求并保留原目录', async () => {
  const track: Track = { source: 'qq', provider: 'qq', type: 'song', id: 'download', name: '下载歌曲', artist: '', artists: [] }
  await runtimeWithPendingGameMode(JSON.stringify({ schema: 1, jobs: [{ track, directory: '/old-downloads' }] }))
  const { useOfflineCacheStore } = await import('../stores/offline-cache')
  const { api } = await import('./api')
  const post = vi.spyOn(api, 'post').mockImplementation(async path => {
    if (path === '/api/audio-cache/status') return { statuses: [{ source: 'qq', id: 'download', state: 'pinned', entryId: 'cached' }] }
    return new Promise(() => {})
  })
  expect(useOfflineCacheStore.getState()).toMatchObject({ paused: true, jobs: [{ status: 'queued', directory: '/old-downloads' }] })
  expect(post).not.toHaveBeenCalled()
  useOfflineCacheStore.getState().setPaused(false)
  for (let i = 0; i < 8; i++) await Promise.resolve()
  expect(useOfflineCacheStore.getState().jobs[0].status).toBe('exporting')
  const { startPlaybackRuntime } = await import('./playback-runtime')
  expect(startPlaybackRuntime()).toBe(stopRuntime)
  expect(post).toHaveBeenCalledTimes(2)
  stopRuntime!()
  expect(post.mock.lastCall?.[3]?.signal?.aborted).toBe(true)
  expect(useOfflineCacheStore.getState().jobs).toEqual([])
  const saved = vi.mocked(localStorage.setItem).mock.calls.filter(call => call[0] === 'simplemusic-download-queue').at(-1)
  expect(JSON.parse(saved![1]).jobs).toEqual([{ track, directory: '/old-downloads' }])
})

it.each([true, false])('主进程初值确认游戏模式 %s 后才决定冷启动是否恢复迷你条', async enabled => {
  const h = await runtimeWithPendingGameMode()
  expect(h.enableMini).not.toHaveBeenCalled()
  expect(h.mini).not.toHaveBeenCalled()
  h.resolve({ enabled })
  await Promise.resolve()
  expect(h.useGameModeStore.getState()).toMatchObject({ initialized: true, enabled })
  if (enabled) {
    expect(h.enableMini).not.toHaveBeenCalled()
    expect(h.mini).not.toHaveBeenCalled()
  } else {
    expect(h.enableMini).toHaveBeenCalledOnce()
    expect(h.enableMini).toHaveBeenCalledWith(true, 360)
    expect(h.mini).toHaveBeenCalledWith({ position: 0 })
  }
})

it('初值查询未完成时停止，迟到初值不恢复窗口或发送数据', async () => {
  const h = await runtimeWithPendingGameMode()
  stopRuntime!()
  h.resolve({ enabled: false })
  await Promise.resolve()
  expect(h.enableMini).not.toHaveBeenCalled()
  expect(h.mini).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
})

it('托盘返回主窗口广播优先于未完成初值，不被冷偏好重新打开迷你条', async () => {
  const h = await runtimeWithPendingGameMode()
  h.notify({ enabled: false })
  h.control({ action: 'sync-off' })
  h.resolve({ enabled: true })
  await Promise.resolve()
  expect(h.enableMini).not.toHaveBeenCalled()
  expect(h.useSettingsStore.getState().miniPlayerEnabled).toBe(false)
  expect(h.useGameModeStore.getState()).toMatchObject({ initialized: true, enabled: false })
})

it('无React时本地歌词经真实管线解析、随位置换行并同步迷你条，游戏纯播放取消生产', async () => {
  const h = await runtimeWithPendingGameMode()
  const { usePlayerStore } = await import('../stores/player')
  const { useLyricsStore } = await import('../stores/lyrics')
  const { api } = await import('./api')
  const lyricRequest = mockLocalLyrics(api, '[00:00.00]第一句\n[00:10.00]第二句')
  h.useSettingsStore.getState().setMiniPlayerWidth(620)
  h.resolve({ enabled: false })
  await Promise.resolve()
  const track: Track = { source: 'local', provider: 'local', type: 'local', id: 'file1', name: '本地曲目', artist: '', artists: [] }
  usePlayerStore.setState({ currentTrack: track, status: 'playing', position: 0 })
  await vi.waitFor(() => expect(useLyricsStore.getState().loading).toBe(false))
  expect(lyricRequest).toHaveBeenCalledOnce()
  expect(lyricRequest).toHaveBeenCalledWith('/api/local/lyric', { id: 'file1' }, { signal: expect.any(AbortSignal) })
  expect(useLyricsStore.getState()).toMatchObject({ trackKey: 'local:file1', source: 'local', currentIndex: 0 })
  expect(h.mini).toHaveBeenCalledWith({ lyricLine: '第一句' })
  usePlayerStore.setState({ position: 12 })
  expect(useLyricsStore.getState().currentIndex).toBe(1)
  expect(h.mini).toHaveBeenLastCalledWith({ lyricLine: '第二句' })
  const { startPlaybackRuntime } = await import('./playback-runtime')
  expect(startPlaybackRuntime()).toBe(stopRuntime)
  expect(lyricRequest).toHaveBeenCalledOnce()
  h.notify({ enabled: true })
  expect(useLyricsStore.getState().loading).toBe(false)
  expect(useLyricsStore.getState()).toMatchObject({ trackKey: null, lines: [], currentIndex: -1 })
  usePlayerStore.setState({ position: 18 })
  expect(lyricRequest).toHaveBeenCalledOnce()
  h.notify({ enabled: false })
  await vi.waitFor(() => expect(useLyricsStore.getState().loading).toBe(false))
  expect(lyricRequest).toHaveBeenCalledTimes(2)
  expect(useLyricsStore.getState().currentIndex).toBe(1)
  stopRuntime!()
  usePlayerStore.setState({ position: 0 })
  expect(useLyricsStore.getState().currentIndex).toBe(1)
})

it('无React时桌面歌词消费真实LRC，原生字号/锁定/关闭回写且宿主停止解除监听', async () => {
  const h = await runtimeWithPendingGameMode()
  const { usePlayerStore } = await import('../stores/player')
  const { useLyricsStore } = await import('../stores/lyrics')
  const { useVisualStore } = await import('../stores/visual')
  const { api } = await import('./api')
  mockLocalLyrics(api, '[00:00.00]第一句\n[00:10.00]第二句')
  h.resolve({ enabled: false })
  await Promise.resolve()
  useVisualStore.getState().updateFx({ desktopLyrics: true, desktopLyricsLineMode: 'double' })
  expect(h.enableLyrics).toHaveBeenLastCalledWith(true, expect.anything())
  const track: Track = { source: 'local', provider: 'local', type: 'local', id: 'file1', name: '本地曲目', artist: '', artists: [] }
  usePlayerStore.setState({ currentTrack: track, status: 'playing', position: 0 })
  await vi.waitFor(() => expect(useLyricsStore.getState().loading).toBe(false))
  expect(h.lyrics).toHaveBeenLastCalledWith(expect.objectContaining({ line: '第一句', nextLine: '第二句', trackKey: 'local:file1' }))
  usePlayerStore.setState({ position: 12 })
  expect(h.lyrics).toHaveBeenLastCalledWith(expect.objectContaining({ line: '第二句', nextLine: '' }))
  h.sizeState({ size: 41.5 })
  expect(useVisualStore.getState().fx.desktopLyricsSize).toBe(41.5)
  expect(h.lyrics.mock.lastCall?.[0]).not.toHaveProperty('size')
  h.lockState({ locked: true })
  expect(h.lyrics).toHaveBeenLastCalledWith(expect.objectContaining({ clickThrough: true }))
  h.enabledState({ enabled: false, requested: true })
  expect(useVisualStore.getState().fx.desktopLyrics).toBe(true)
  h.enabledState({ enabled: false })
  expect(useVisualStore.getState().fx.desktopLyrics).toBe(false)
  expect(useLyricsStore.getState().desktopLyricsEnabled).toBe(false)
  stopRuntime!()
  expect(h.stopLyricsEvents.enabled).toHaveBeenCalledOnce()
  expect(h.stopLyricsEvents.lock).toHaveBeenCalledOnce()
  expect(h.stopLyricsEvents.size).toHaveBeenCalledOnce()
  const pushes = h.lyrics.mock.calls.length
  h.sizeState({ size: 90 })
  h.lockState({ locked: false })
  h.enabledState({ enabled: true })
  usePlayerStore.setState({ position: 0 })
  expect(h.lyrics).toHaveBeenCalledTimes(pushes)
  expect(useVisualStore.getState().fx).toMatchObject({ desktopLyrics: false, desktopLyricsSize: 41.5, desktopLyricsClickThrough: true })
})

it('无React时封面像素经真实取色管线更新迷你条，重复启动不重取且停止后旧结果无效', async () => {
  const images: { src: string; onload: (() => void) | null; onerror: (() => void) | null }[] = []
  vi.stubGlobal('Image', class {
    src = ''
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    constructor() { images.push(this) }
  })
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => ({
    drawImage: vi.fn(), getImageData: () => ({ data: new Uint8ClampedArray([255, 0, 0, 255]) })
  }) }) })
  const h = await runtimeWithPendingGameMode()
  const { usePlayerStore } = await import('../stores/player')
  const { useAmbientStore } = await import('../stores/ambient')
  const { DEFAULT_PALETTE } = await import('./extract-color')
  const { api } = await import('./api')
  mockLocalLyrics(api, '')
  h.resolve({ enabled: false })
  await Promise.resolve()
  const track: Track = { source: 'local', provider: 'local', type: 'local', id: 'cover1', name: '本地封面', artist: '', artists: [], cover: 'https://example.com/cover.jpg' }
  usePlayerStore.setState({ currentTrack: track })
  images[0].onload!()
  const palette = useAmbientStore.getState().palette
  expect(palette[0]).not.toBe(DEFAULT_PALETTE[0])
  expect(useAmbientStore.getState().coverLuma).toBeCloseTo(0.2126)
  expect(h.mini).toHaveBeenLastCalledWith({ accent: palette[0] })
  const { startPlaybackRuntime } = await import('./playback-runtime')
  expect(startPlaybackRuntime()).toBe(stopRuntime)
  expect(images).toHaveLength(1)
  const lateLoad = images[0].onload!
  const lateError = images[0].onerror!
  stopRuntime!()
  const pushes = h.mini.mock.calls.length
  expect(images[0]).toMatchObject({ src: '', onload: null, onerror: null })
  lateLoad()
  lateError()
  usePlayerStore.setState({ currentTrack: { ...track, cover: 'https://example.com/new.jpg' } })
  expect(images).toHaveLength(1)
  expect(h.mini).toHaveBeenCalledTimes(pushes)
  expect(useAmbientStore.getState().palette).toBe(palette)
})

it('无React时壁纸随设置更新，游戏恢复补完整快照，重启入口与停止均不重复副作用', async () => {
  const h = await runtimeWithPendingGameMode()
  const { useVisualStore } = await import('../stores/visual')
  expect(h.wallpaper).toHaveBeenLastCalledWith(useVisualStore.getState().fx)
  h.resolve({ enabled: true })
  await Promise.resolve()
  const suspendedPushes = h.wallpaper.mock.calls.length
  useVisualStore.getState().updateFx({ speed: 0.65, bloom: false })
  expect(h.wallpaper).toHaveBeenCalledTimes(suspendedPushes)
  h.notify({ enabled: false })
  expect(h.wallpaper).toHaveBeenCalledTimes(suspendedPushes + 1)
  expect(h.wallpaper).toHaveBeenLastCalledWith(useVisualStore.getState().fx)
  const { startPlaybackRuntime } = await import('./playback-runtime')
  expect(startPlaybackRuntime()).toBe(stopRuntime)
  expect(h.wallpaper).toHaveBeenCalledTimes(suspendedPushes + 1)
  useVisualStore.getState().updateFx({ speed: 0.85 })
  expect(h.wallpaper.mock.lastCall![0]).toMatchObject({ speed: 0.85, bloom: false })
  stopRuntime!()
  const pushes = h.wallpaper.mock.calls.length
  useVisualStore.getState().updateFx({ speed: 0.2 })
  h.notify({ enabled: false })
  expect(h.wallpaper).toHaveBeenCalledTimes(pushes)
})

it('无React时真实刷歌会话按片段续播、接收外部上下首，导航恢复原暂停队列且退出先保存快照', async () => {
  const h = await runtimeWithPendingGameMode()
  const { usePlayerStore } = await import('../stores/player')
  const { usePlaylistStore } = await import('../stores/playlist')
  const { useProviderStore } = await import('../stores/providers')
  const { useNavigationStore } = await import('../stores/navigation')
  const { useShuangeStore } = await import('../stores/shuange')
  const { neteaseService } = await import('./service-registry')
  const preload = await import('./track-preload')
  const original: Track = { source: 'netease', provider: 'netease', type: 'song', id: 'original', name: '原队列', artist: '', artists: [], duration: 180_000 }
  const feed = [1, 2].map(id => ({ ...original, id, name: `刷歌${id}` }))
  vi.spyOn(neteaseService, 'getDailySongs').mockResolvedValue(feed)
  vi.spyOn(neteaseService, 'getRecommendPlaylists').mockResolvedValue([])
  vi.spyOn(neteaseService, 'getRadarPlaylist').mockResolvedValue(null)
  vi.spyOn(neteaseService, 'getListeningRanking').mockResolvedValue([])
  vi.spyOn(neteaseService, 'getLikedPlaylist').mockResolvedValue(null)
  vi.spyOn(neteaseService, 'getLyrics').mockResolvedValue([])
  vi.spyOn(preload, 'preloadTracks').mockImplementation(() => {})
  const load = vi.spyOn(usePlayerStore.getState(), 'loadTrack').mockImplementation(async (currentTrack, options) => {
    usePlayerStore.setState({ currentTrack, position: options?.startAt ?? 0, status: options?.autoplay === false ? 'paused' : 'playing' })
  })
  vi.spyOn(usePlayerStore.getState(), 'pause').mockImplementation(() => { usePlayerStore.setState({ status: 'paused' }) })
  vi.spyOn(usePlayerStore.getState(), 'setVolume').mockImplementation(volume => { usePlayerStore.setState({ volume }) })
  const queue = [original]
  usePlaylistStore.setState({ queue, queueIndex: 0, shuffleOrder: [0], queueContextId: 'original-list' })
  usePlayerStore.setState({ currentTrack: original, position: 17, status: 'paused', volume: 0.4 })
  useProviderStore.setState({ playbackOrder: ['netease'], byId: {
    netease: { enabled: true, auth: 'authenticated' }, qq: { enabled: false, auth: 'anonymous' }, apple: { enabled: false, auth: 'anonymous' }
  } })
  h.resolve({ enabled: false })
  const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve() }
  useNavigationStore.getState().navigateTo('shuange')
  await flush()
  expect(useShuangeStore.getState()).toMatchObject({ active: true, index: 0, loading: false })
  const clips = useShuangeStore.getState().feed
  expect(usePlayerStore.getState().currentTrack).toBe(clips[0])
  usePlayerStore.setState({ position: useShuangeStore.getState().offset!.endSec })
  await flush()
  expect(usePlayerStore.getState().currentTrack).toBe(clips[1])
  h.control({ action: 'prev' })
  await flush()
  expect(usePlayerStore.getState().currentTrack).toBe(clips[0])
  const { startPlaybackRuntime } = await import('./playback-runtime')
  const loads = load.mock.calls.length
  startPlaybackRuntime()
  expect(load).toHaveBeenCalledTimes(loads)
  expect(usePlaylistStore.getState().queue).toBe(queue)
  useNavigationStore.getState().navigateTo('library')
  await flush()
  expect(usePlayerStore.getState()).toMatchObject({ currentTrack: original, position: 17, status: 'paused' })
  useNavigationStore.getState().navigateTo('shuange')
  await flush()
  const beforeStop = load.mock.calls.length
  const write = vi.spyOn(localStorage, 'setItem')
  stopRuntime!()
  const saved = write.mock.calls.filter(([key]) => key === 'simplemusic-playback').at(-1)![1]
  expect(JSON.parse(saved)).toMatchObject({ queue, queueIndex: 0, shuffleOrder: [0], position: 17 })
  expect(load).toHaveBeenCalledTimes(beforeStop)
  expect(useShuangeStore.getState().active).toBe(false)
})

it('不挂载React也能恢复暂停态、记历史和同步系统；重复启动不重置，释放后停止副作用', async () => {
  vi.resetModules()
  vi.useFakeTimers()
  const track: Track = { provider: 'netease', source: 'netease', type: 'song', id: 1, name: '恢复歌曲', artist: '歌手', artists: [], duration: 200_000 }
  const storage = new Map([
    ['simplemusic-settings', JSON.stringify({ audioQuality: 'standard', mediaKeysEnabled: true, miniPlayerEnabled: true, miniPlayerWidth: 360 })],
    ['simplemusic-playback', JSON.stringify({ schema: 2, queue: [track], queueIndex: 0, shuffleOrder: [0], position: 12, volume: 0.4 })],
  ])
  const write = vi.fn((key: string, value: string) => storage.set(key, value))
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: write })
  const events = new Map<string, () => void>()
  const tray = vi.fn(async () => ({ ok: true }))
  const stopFlush = vi.fn()
  const onFlush = vi.fn(() => stopFlush)
  const stopControls = vi.fn()
  const stopHotkeys = vi.fn()
  let onControl: ((payload: { action: string; value?: number }) => void) | undefined
  let onHotkey: ((payload: { action: string }) => void) | undefined
  const controls = vi.fn((callback: typeof onControl) => { onControl = callback; return stopControls })
  const hotkeys = vi.fn((callback: typeof onHotkey) => { onHotkey = callback; return stopHotkeys })
  const configureHotkeys = vi.fn(async () => ({ ok: true, results: [] }))
  const mini = vi.fn(async () => ({ ok: true }))
  const enableMini = vi.fn(async () => ({ ok: true }))
  const stopWidth = vi.fn()
  const stopGameMode = vi.fn()
  let onGameMode: ((state: GameModeState) => void) | undefined
  const gameMode = vi.fn((callback: typeof onGameMode) => { onGameMode = callback; return stopGameMode })
  vi.stubGlobal('window', {
    desktop: { updateTrayPlayback: tray, onFlushListeningReports: onFlush, onMiniPlayerControl: controls, onHotkey: hotkeys, configureHotkeys,
      updateMiniPlayer: mini, setMiniPlayerEnabled: enableMini, onMiniPlayerWidthChanged: vi.fn(() => stopWidth),
      onGameModeChange: gameMode, getGameMode: async () => ({ enabled: false }) },
    addEventListener: (name: string, listener: () => void) => events.set(name, listener),
    removeEventListener: (name: string) => events.delete(name),
  })
  vi.stubGlobal('document', { hasFocus: () => false })
  const audio = { volume: 1, addEventListener: vi.fn(), pause: vi.fn() }
  vi.stubGlobal('Audio', vi.fn(function () { return audio }))
  const handlers = new Map<MediaSessionAction, MediaSessionActionHandler | null>()
  const media = { metadata: null, playbackState: 'none', setPositionState: vi.fn(),
    setActionHandler: (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => handlers.set(action, handler) }
  vi.stubGlobal('navigator', { mediaSession: media })
  vi.stubGlobal('MediaMetadata', class { constructor(data: unknown) { Object.assign(this, data) } })
  const { startPlaybackRuntime } = await import('./playback-runtime')
  const { usePlayerStore } = await import('../stores/player')
  const { usePlaylistStore } = await import('../stores/playlist')
  const { useRecentPlaysStore } = await import('../stores/recent')
  const play = vi.spyOn(usePlayerStore.getState(), 'play').mockImplementation(() => {})
  stopRuntime = startPlaybackRuntime()
  await Promise.resolve()
  expect(usePlayerStore.getState()).toMatchObject({ currentTrack: track, status: 'paused', position: 12, quality: 'standard' })
  expect(useRecentPlaysStore.getState().items).toEqual([])
  expect(tray).toHaveBeenCalledOnce()
  expect(tray).toHaveBeenCalledWith(expect.objectContaining({ title: '恢复歌曲', playing: false, volume: 0.4 }))
  expect(media.metadata).toMatchObject({ title: '恢复歌曲' })
  onControl?.({ action: 'volume', value: 0.8 })
  onHotkey?.({ action: 'volume-down' })
  expect(usePlayerStore.getState().volume).toBe(0.75)
  expect(audio.volume).toBe(0.75)
  expect(controls).toHaveBeenCalledOnce()
  expect(hotkeys).toHaveBeenCalledOnce()
  expect(configureHotkeys).toHaveBeenCalledOnce()
  expect(enableMini).toHaveBeenCalledOnce()
  expect(enableMini).toHaveBeenCalledWith(true, 360)
  expect(mini).toHaveBeenCalledWith(expect.objectContaining({ trackTitle: '恢复歌曲', playing: false }))
  expect(mini).toHaveBeenCalledWith({ position: 12 })
  expect(mini).toHaveBeenLastCalledWith({ volume: 0.75 })
  onGameMode?.({ enabled: true })
  const pausedMiniPushes = mini.mock.calls.length
  usePlayerStore.setState({ position: 13 })
  expect(mini).toHaveBeenCalledTimes(pausedMiniPushes)
  onGameMode?.({ enabled: false })
  expect(mini).toHaveBeenLastCalledWith({ position: 13 })

  const next = { ...track, id: 2, name: '新歌曲' }
  usePlaylistStore.setState({ queue: [next] })
  usePlayerStore.setState({ currentTrack: next, status: 'loading', position: 0 })
  const pushes = tray.mock.calls.length
  for (let position = 1; position <= 100; position++) usePlayerStore.setState({ position })
  expect(tray).toHaveBeenCalledTimes(pushes)
  expect(startPlaybackRuntime()).toBe(stopRuntime)
  expect(usePlayerStore.getState().position).toBe(100)
  expect(useRecentPlaysStore.getState().items.map(item => item.track.id)).toEqual([2])
  expect(write.mock.calls.filter(([key]) => key === 'simplemusic-recent-plays')).toHaveLength(1)
  expect(onFlush).toHaveBeenCalledOnce()
  expect(enableMini).toHaveBeenCalledOnce()
  expect(gameMode).toHaveBeenCalledOnce()
  const stalePlay = handlers.get('play')!
  stalePlay({ action: 'play' })
  expect(play).toHaveBeenCalledOnce()

  stopRuntime()
  stopRuntime()
  expect(JSON.parse(storage.get('simplemusic-playback')!)).toMatchObject({ queue: [next], position: 100 })
  expect(events.has('beforeunload')).toBe(false)
  expect(stopFlush).toHaveBeenCalledOnce()
  expect(stopControls).toHaveBeenCalledOnce()
  expect(stopHotkeys).toHaveBeenCalledOnce()
  expect(stopWidth).toHaveBeenCalledOnce()
  expect(stopGameMode).toHaveBeenCalledOnce()
  expect(configureHotkeys).toHaveBeenLastCalledWith([])
  expect(handlers.get('play')).toBeNull()
  expect(media.metadata).toBeNull()
  expect(media.playbackState).toBe('none')
  const writeCount = write.mock.calls.length
  const trayCount = tray.mock.calls.length
  const miniCount = mini.mock.calls.length
  usePlayerStore.setState({ currentTrack: { ...next, id: 3 }, status: 'loading', volume: 0.2 })
  vi.runAllTimers()
  stalePlay({ action: 'play' })
  onControl?.({ action: 'volume', value: 1 })
  onHotkey?.({ action: 'volume-down' })
  onGameMode?.({ enabled: true })
  expect(usePlayerStore.getState().volume).toBe(0.2)
  expect(play).toHaveBeenCalledOnce()
  expect(write).toHaveBeenCalledTimes(writeCount)
  expect(tray).toHaveBeenCalledTimes(trayCount)
  expect(mini).toHaveBeenCalledTimes(miniCount)
  const { useGameModeStore } = await import('../stores/game-mode')
  expect(useGameModeStore.getState().enabled).toBe(false)
})
