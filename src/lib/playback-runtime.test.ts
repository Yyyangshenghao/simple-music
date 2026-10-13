import { afterEach, expect, it, vi } from 'vitest'
import type { Track } from '../types/domain'
import type { GameModeState } from '../types/ipc'

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
  vi.stubGlobal('window', {
    desktop: {
      updateMiniPlayer: mini, setMiniPlayerEnabled: enableMini, onMiniPlayerWidthChanged: () => vi.fn(),
      onGameModeChange: (callback: typeof notify) => { notify = callback; return vi.fn() },
      getGameMode: () => new Promise<GameModeState>(done => { resolve = done }),
      onMiniPlayerControl: (callback: typeof control) => { control = callback; return vi.fn() },
      configureHotkeys: async () => ({ ok: true, results: [] }), onHotkey: () => vi.fn(), onFlushListeningReports: () => vi.fn()
    },
    addEventListener: vi.fn(), removeEventListener: vi.fn()
  })
  vi.stubGlobal('navigator', {})
  const { startPlaybackRuntime } = await import('./playback-runtime')
  stopRuntime = startPlaybackRuntime()
  const { useGameModeStore } = await import('../stores/game-mode')
  const { useSettingsStore } = await import('../stores/settings')
  return { resolve, notify, control, mini, enableMini, useGameModeStore, useSettingsStore }
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
