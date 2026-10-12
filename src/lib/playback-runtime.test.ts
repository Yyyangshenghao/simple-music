import { afterEach, expect, it, vi } from 'vitest'
import type { Track } from '../types/domain'

let stopRuntime: (() => void) | undefined
afterEach(() => {
  stopRuntime?.()
  vi.restoreAllMocks()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it('不挂载React也能恢复暂停态、记历史和同步系统；重复启动不重置，释放后停止副作用', async () => {
  vi.resetModules()
  vi.useFakeTimers()
  const track: Track = { provider: 'netease', source: 'netease', type: 'song', id: 1, name: '恢复歌曲', artist: '歌手', artists: [], duration: 200_000 }
  const storage = new Map([
    ['simplemusic-settings', JSON.stringify({ audioQuality: 'standard', mediaKeysEnabled: true })],
    ['simplemusic-playback', JSON.stringify({ schema: 2, queue: [track], queueIndex: 0, shuffleOrder: [0], position: 12, volume: 0.4 })],
  ])
  const write = vi.fn((key: string, value: string) => storage.set(key, value))
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: write })
  const events = new Map<string, () => void>()
  const tray = vi.fn(async () => ({ ok: true }))
  const stopFlush = vi.fn()
  const onFlush = vi.fn(() => stopFlush)
  vi.stubGlobal('window', {
    desktop: { updateTrayPlayback: tray, onFlushListeningReports: onFlush },
    addEventListener: (name: string, listener: () => void) => events.set(name, listener),
    removeEventListener: (name: string) => events.delete(name),
  })
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
  expect(usePlayerStore.getState()).toMatchObject({ currentTrack: track, status: 'paused', position: 12, quality: 'standard' })
  expect(useRecentPlaysStore.getState().items).toEqual([])
  expect(tray).toHaveBeenCalledOnce()
  expect(tray).toHaveBeenCalledWith(expect.objectContaining({ title: '恢复歌曲', playing: false, volume: 0.4 }))
  expect(media.metadata).toMatchObject({ title: '恢复歌曲' })

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
  const stalePlay = handlers.get('play')!
  stalePlay({ action: 'play' })
  expect(play).toHaveBeenCalledOnce()

  stopRuntime()
  stopRuntime()
  expect(JSON.parse(storage.get('simplemusic-playback')!)).toMatchObject({ queue: [next], position: 100 })
  expect(events.has('beforeunload')).toBe(false)
  expect(stopFlush).toHaveBeenCalledOnce()
  expect(handlers.get('play')).toBeNull()
  expect(media.metadata).toBeNull()
  expect(media.playbackState).toBe('none')
  const writeCount = write.mock.calls.length
  const trayCount = tray.mock.calls.length
  usePlayerStore.setState({ currentTrack: { ...next, id: 3 }, status: 'loading', volume: 0.2 })
  vi.runAllTimers()
  stalePlay({ action: 'play' })
  expect(play).toHaveBeenCalledOnce()
  expect(write).toHaveBeenCalledTimes(writeCount)
  expect(tray).toHaveBeenCalledTimes(trayCount)
})
