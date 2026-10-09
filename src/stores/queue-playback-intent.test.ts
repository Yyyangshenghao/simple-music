import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AudioEngineCallbacks } from '../lib/audio-engine'
import type { Track } from '../types/domain'
import { makePlaceholderTrack } from '../lib/lazy-window'
import { beginPlaybackIntent, isCurrentPlaybackIntent } from '../lib/playback-intent'

const h = vi.hoisted(() => ({
  callbacks: {} as AudioEngineCallbacks,
  loadId: 0,
  hasSource: false,
  load: vi.fn(), play: vi.fn(), pause: vi.fn(), seek: vi.fn(), details: vi.fn(),
}))
vi.mock('../lib/audio-engine', () => ({
  AudioEngine: vi.fn(function (callbacks: AudioEngineCallbacks) {
    h.callbacks = callbacks
    return {
      load: h.load, play: h.play, pause: h.pause, seek: h.seek,
      setVolume: vi.fn(), setPlaybackRate: vi.fn(),
      clearSource: () => { h.hasSource = false },
      get hasSource() { return h.hasSource },
    }
  }),
}))
vi.mock('../lib/service-registry', () => ({ serviceFor: () => ({ getTracksByIds: h.details }) }))
vi.mock('../lib/track-preload', () => ({ preloadTracks: vi.fn(), getPreloadedResolution: vi.fn() }))
vi.mock('../lib/offline-cache', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/offline-cache')>(),
  fetchOfflineStatus: vi.fn(async (track: Track) => ({ source: track.source, id: String(track.id), state: 'pinned', entryId: String(track.id) })),
}))

import { usePlaylistStore } from './playlist'
import { usePlayerStore } from './player'
import { useProviderStore } from './providers'
import { useSettingsStore } from './settings'
import { useRecentPlaysStore } from './recent'
import { useSleepTimerStore } from './sleep-timer'

function song(id: string): Track {
  return { provider: 'netease', source: 'netease', type: 'song', id, name: id, artist: '歌手', artists: [], duration: 180_000 }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe('队列详情等待期间的播放意图', () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    vi.stubGlobal('window', { desktop: { serverPort: 35530, serverToken: 'test-token' } })
    h.load.mockImplementation(() => { h.hasSource = true; return ++h.loadId })
    h.play.mockResolvedValue(undefined)
    h.details.mockReset().mockImplementation(async (ids: string[]) => ids.map(song))
    useProviderStore.setState({ byId: {
      netease: { enabled: true, auth: 'authenticated' },
      qq: { enabled: true, auth: 'authenticated' },
      apple: { enabled: true, auth: 'authenticated' },
    } })
    useSettingsStore.setState({ playMode: 'order', audioQuality: 'lossless' })
    usePlaylistStore.setState({ queue: [], queueIndex: -1, shuffleOrder: [], queueContextId: null })
    await usePlayerStore.getState().loadTrack(song('A'))
    h.callbacks.onStatus?.('playing')
    useRecentPlaysStore.setState({ items: [] })
    vi.clearAllMocks()
  })

  afterEach(() => {
    useSleepTimerStore.getState().cancel()
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it.each(['loadTrack', 'play', 'pause', 'stop', 'setQueue', 'clearQueue', 'playAt', 'next', 'prev'] as const)('%s 的新用户意图使外部等待中的榜单失效', async action => {
    usePlaylistStore.setState({ queue: [song('A'), song('B')], queueIndex: 0 })
    const intent = beginPlaybackIntent()
    if (action === 'loadTrack') await usePlayerStore.getState().loadTrack(song('C'))
    else if (action === 'setQueue') usePlaylistStore.getState().setQueue([])
    else if (action === 'playAt') usePlaylistStore.getState().playAt(1)
    else if (action === 'clearQueue' || action === 'next' || action === 'prev') usePlaylistStore.getState()[action]()
    else usePlayerStore.getState()[action]()
    expect(isCurrentPlaybackIntent(intent)).toBe(false)
  })

  it.each(['order', 'one'] as const)('自然结束的 %s 走序不抢占等待中的榜单意图', async playMode => {
    useSettingsStore.setState({ playMode })
    usePlaylistStore.setState({ queue: [song('A'), song('B')], queueIndex: 0 })
    const intent = beginPlaybackIntent()
    h.callbacks.onEnded?.()
    if (playMode === 'order') await vi.waitFor(() => expect(h.load).toHaveBeenCalledOnce())
    expect(isCurrentPlaybackIntent(intent)).toBe(true)
    expect(usePlayerStore.getState().currentTrack?.id).toBe(playMode === 'one' ? 'A' : 'B')
  })

  it('自动音质重载保留等待中的榜单意图', async () => {
    const intent = beginPlaybackIntent()
    useSettingsStore.getState().setAudioQuality('standard')
    await vi.waitFor(() => expect(h.load).toHaveBeenCalledOnce())
    expect(isCurrentPlaybackIntent(intent)).toBe(true)
  })

  it('空队列追加歌曲不自动播放，点击播放后从队列首曲起播', async () => {
    usePlayerStore.setState({ currentTrack: null, status: 'idle' })
    expect(usePlaylistStore.getState().addManyToQueue([song('B'), song('C')])).toBe(2)
    expect(h.load).not.toHaveBeenCalled()
    expect(usePlaylistStore.getState().queueIndex).toBe(-1)

    usePlayerStore.getState().play()
    await vi.waitFor(() => expect(h.load).toHaveBeenCalledOnce())
    expect(usePlaylistStore.getState().queueIndex).toBe(0)
    expect(usePlayerStore.getState().currentTrack).toEqual(song('B'))
    expect(h.play).toHaveBeenCalledOnce()
  })

  it('清空正在播放的队列后释放音轨和播放信息，再次播放不恢复旧歌曲', () => {
    usePlaylistStore.setState({ queue: [song('A'), song('B')], queueIndex: 0, queueContextId: 'album', shuffleOrder: [1, 0] })
    usePlayerStore.setState({ position: 30, duration: 180 })
    usePlaylistStore.getState().clearQueue()

    expect(h.hasSource).toBe(false)
    expect(usePlaylistStore.getState()).toMatchObject({ queue: [], queueIndex: -1, queueContextId: null, shuffleOrder: [] })
    expect(usePlayerStore.getState()).toMatchObject({ currentTrack: null, status: 'idle', position: 0, duration: 0, actualSource: null, contextId: null })
    h.callbacks.onPosition?.(80)
    h.callbacks.onEnded?.()
    usePlayerStore.getState().toggle()
    expect(h.load).not.toHaveBeenCalled()
    expect(h.play).not.toHaveBeenCalled()
    expect(usePlayerStore.getState().status).toBe('idle')
  })

  it('等待播完当前曲的睡眠定时器在清空时结束，不影响之后追加的歌曲', async () => {
    useSleepTimerStore.getState().start(1)
    vi.advanceTimersByTime(60_000)
    expect(useSleepTimerStore.getState().phase).toBe('finishing-track')
    usePlaylistStore.getState().clearQueue()
    expect(useSleepTimerStore.getState().phase).toBe('idle')

    usePlaylistStore.getState().addManyToQueue([song('B'), song('C')])
    usePlayerStore.getState().play()
    await vi.waitFor(() => expect(h.load).toHaveBeenCalledOnce())
    h.callbacks.onEnded?.()
    expect(usePlaylistStore.getState().queueIndex).toBe(1)
    expect(usePlayerStore.getState().currentTrack).toEqual(song('C'))
  })

  it('等待详情时清空并追加同一占位曲目，迟到响应不重新起播或选曲', async () => {
    const request = deferred<Track[]>()
    h.details.mockReturnValue(request.promise)
    const pending = makePlaceholderTrack('B', 'netease')
    usePlaylistStore.setState({ queue: [pending] })
    usePlaylistStore.getState().playAt(0)
    usePlaylistStore.getState().clearQueue()
    usePlaylistStore.getState().addManyToQueue([pending])
    request.resolve([song('B')])
    await usePlaylistStore.getState().ensureQueueDetails([0])
    await Promise.resolve()

    expect(h.load).not.toHaveBeenCalled()
    expect(h.play).not.toHaveBeenCalled()
    expect(usePlaylistStore.getState().queueIndex).toBe(-1)
    expect(usePlayerStore.getState()).toMatchObject({ currentTrack: null, status: 'idle' })
    usePlayerStore.getState().play()
    await vi.waitFor(() => expect(h.load).toHaveBeenCalledOnce())
    expect(usePlayerStore.getState().currentTrack).toEqual(song('B'))
  })

  it('点击占位曲目后暂停，迟到详情不会自动开播并保留定位', async () => {
    const request = deferred<Track[]>()
    h.details.mockReturnValue(request.promise)
    usePlaylistStore.setState({ queue: [song('A'), makePlaceholderTrack('B', 'netease')], queueIndex: 0 })
    usePlaylistStore.getState().playAt(1)
    expect(useRecentPlaysStore.getState().items).toEqual([])
    usePlayerStore.getState().toggle()
    usePlayerStore.getState().seek(45)
    request.resolve([song('B')])

    await vi.waitFor(() => expect(h.load).toHaveBeenCalledOnce())
    expect(h.play).not.toHaveBeenCalled()
    expect(h.load).toHaveBeenCalledWith(expect.stringContaining('id=B'), 45)
    expect(usePlayerStore.getState()).toMatchObject({ currentTrack: song('B'), status: 'paused', position: 45 })
    expect(usePlaylistStore.getState().queue[1]).toEqual(song('B'))
    expect(useRecentPlaysStore.getState().items[0].track).toEqual(song('B'))
    expect(h.details).toHaveBeenCalledOnce()
  })

  it('等待期间先暂停再恢复，详情到达前不播放，完成后从最新位置起播', async () => {
    const request = deferred<Track[]>()
    h.details.mockReturnValue(request.promise)
    usePlaylistStore.setState({ queue: [makePlaceholderTrack('B', 'netease')] })
    usePlaylistStore.getState().playAt(0)
    usePlayerStore.getState().toggle()
    usePlayerStore.getState().seek(23)
    usePlayerStore.getState().toggle()
    expect(h.play).not.toHaveBeenCalled()
    expect(usePlayerStore.getState().status).toBe('loading')
    request.resolve([song('B')])

    await vi.waitFor(() => expect(h.play).toHaveBeenCalledOnce())
    expect(h.load).toHaveBeenCalledWith(expect.stringContaining('id=B'), 23)
    expect(h.details).toHaveBeenCalledOnce()
  })

  it('等待详情时停止旧音轨，旧进度和结束事件不能污染新目标', async () => {
    const request = deferred<Track[]>()
    h.details.mockReturnValue(request.promise)
    usePlaylistStore.setState({ queue: [song('A'), makePlaceholderTrack('B', 'netease'), song('C')], queueIndex: 0 })
    usePlaylistStore.getState().playAt(1)
    expect(h.hasSource).toBe(false)
    h.callbacks.onPosition?.(80)
    h.callbacks.onEnded?.()
    expect(usePlayerStore.getState()).toMatchObject({ currentTrack: { id: 'B' }, status: 'loading', position: 0 })
    expect(usePlaylistStore.getState().queueIndex).toBe(1)
    request.resolve([song('B')])
    await vi.waitFor(() => expect(h.load).toHaveBeenCalledOnce())
  })

  it('详情未返回时切到另一首，迟到响应不重载旧目标', async () => {
    const request = deferred<Track[]>()
    h.details.mockReturnValue(request.promise)
    usePlaylistStore.setState({ queue: [makePlaceholderTrack('B', 'netease'), song('C')] })
    usePlaylistStore.getState().playAt(0)
    usePlaylistStore.getState().playAt(1)
    await vi.waitFor(() => expect(h.load).toHaveBeenCalledOnce())
    request.resolve([song('B')])
    // 等待共享详情链完成，确认迟到回调已执行。
    await usePlaylistStore.getState().ensureQueueDetails([0])
    await Promise.resolve()
    expect(h.load).toHaveBeenCalledOnce()
    expect(h.play).toHaveBeenCalledOnce()
    expect(usePlayerStore.getState().currentTrack).toEqual(song('C'))
    expect(useRecentPlaysStore.getState().items.map(({ track }) => track.id)).toEqual(['C'])
  })

  it('可见范围、播放和等待期间音质重载共用详情请求并保留暂停意图', async () => {
    const request = deferred<Track[]>()
    h.details.mockReturnValue(request.promise)
    usePlaylistStore.setState({ queue: [makePlaceholderTrack('B', 'netease'), song('C')] })
    const details = usePlaylistStore.getState().ensureQueueDetails([0])
    usePlaylistStore.getState().playAt(0)
    useSettingsStore.getState().setAudioQuality('standard')
    usePlaylistStore.getState().moveQueueItem(0, 1)
    usePlayerStore.getState().pause()
    usePlayerStore.getState().seek(32)
    request.resolve([song('B')])
    await details

    await vi.waitFor(() => expect(h.load).toHaveBeenCalledOnce())
    expect(h.details).toHaveBeenCalledOnce()
    expect(h.play).not.toHaveBeenCalled()
    expect(h.load).toHaveBeenCalledWith(expect.stringContaining('id=B'), 32)
    expect(usePlaylistStore.getState().queue[1]).toEqual(song('B'))
    expect(usePlaylistStore.getState().queueIndex).toBe(1)
    expect(usePlayerStore.getState().status).toBe('paused')
  })

  it('详情失败后按 id 兜底仍保留等待期间的暂停和位置', async () => {
    const request = deferred<Track[]>()
    h.details.mockReturnValue(request.promise)
    usePlaylistStore.setState({ queue: [makePlaceholderTrack('B', 'netease')] })
    usePlaylistStore.getState().playAt(0)
    usePlayerStore.getState().pause()
    usePlayerStore.getState().seek(12)
    request.resolve([])

    await vi.waitFor(() => expect(h.load).toHaveBeenCalledOnce())
    expect(h.play).not.toHaveBeenCalled()
    expect(h.load).toHaveBeenCalledWith(expect.stringContaining('id=B'), 12)
    expect(usePlayerStore.getState()).toMatchObject({ currentTrack: { id: 'B', pending: false }, status: 'paused', position: 12 })
  })
})
