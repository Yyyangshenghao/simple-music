import { afterEach, expect, it, vi } from 'vitest'
import type { Track } from '../types/domain'
import type { GameModeState, LyricsPayload } from '../types/ipc'

let stopRuntime: (() => void) | undefined
afterEach(() => {
  stopRuntime?.()
  vi.restoreAllMocks()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function runtimeWithPendingGameMode() {
  vi.resetModules()
  vi.useFakeTimers()
  const settings = JSON.stringify({ globalHotkeysEnabled: false, miniPlayerEnabled: true, miniPlayerWidth: 360 })
  vi.stubGlobal('localStorage', { getItem: (key: string) => key === 'simplemusic-settings' ? settings : null, setItem: vi.fn() })
  let resolve!: (state: GameModeState) => void
  let notify!: (state: GameModeState) => void
  let control!: (payload: { action: string }) => void
  const enableMini = vi.fn(async () => ({ ok: true }))
  const mini = vi.fn(async () => ({ ok: true }))
  const lyrics = vi.fn(async (_payload: LyricsPayload) => ({ ok: true }))
  const enableLyrics = vi.fn(async (_enabled: boolean, _payload: LyricsPayload) => ({ ok: true }))
  let enabledState!: (state: { enabled: boolean; requested?: boolean }) => void
  let lockState!: (state: { locked: boolean }) => void
  let sizeState!: (state: { size: number }) => void
  const stopLyricsEvents = { enabled: vi.fn(), lock: vi.fn(), size: vi.fn() }
  vi.stubGlobal('window', {
    desktop: {
      updateMiniPlayer: mini, setMiniPlayerEnabled: enableMini, onMiniPlayerWidthChanged: () => vi.fn(),
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
  const { startPlaybackRuntime } = await import('./playback-runtime')
  stopRuntime = startPlaybackRuntime()
  const { useGameModeStore } = await import('../stores/game-mode')
  const { useSettingsStore } = await import('../stores/settings')
  return { resolve, notify, control, mini, enableMini, useGameModeStore, useSettingsStore,
    lyrics, enableLyrics, enabledState, lockState, sizeState, stopLyricsEvents }
}

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
  const lyricRequest = vi.spyOn(api, 'get').mockResolvedValue({ lyric: '[00:00.00]第一句\n[00:10.00]第二句' })
  h.useSettingsStore.getState().setMiniPlayerWidth(620)
  h.resolve({ enabled: false })
  await Promise.resolve()
  const track: Track = { source: 'local', provider: 'local', type: 'local', id: 'file1', name: '本地曲目', artist: '', artists: [] }
  usePlayerStore.setState({ currentTrack: track, status: 'playing', position: 0 })
  for (let i = 0; i < 8; i++) await Promise.resolve()
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
  const signal = lyricRequest.mock.calls[0][2]?.signal
  h.notify({ enabled: true })
  expect(signal?.aborted).toBe(true)
  expect(useLyricsStore.getState()).toMatchObject({ trackKey: null, lines: [], currentIndex: -1 })
  usePlayerStore.setState({ position: 18 })
  expect(lyricRequest).toHaveBeenCalledOnce()
  h.notify({ enabled: false })
  for (let i = 0; i < 8; i++) await Promise.resolve()
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
  vi.spyOn(api, 'get').mockResolvedValue({ lyric: '[00:00.00]第一句\n[00:10.00]第二句' })
  h.resolve({ enabled: false })
  await Promise.resolve()
  useVisualStore.getState().updateFx({ desktopLyrics: true, desktopLyricsLineMode: 'double' })
  expect(h.enableLyrics).toHaveBeenLastCalledWith(true, expect.anything())
  const track: Track = { source: 'local', provider: 'local', type: 'local', id: 'file1', name: '本地曲目', artist: '', artists: [] }
  usePlayerStore.setState({ currentTrack: track, status: 'playing', position: 0 })
  for (let i = 0; i < 8; i++) await Promise.resolve()
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
