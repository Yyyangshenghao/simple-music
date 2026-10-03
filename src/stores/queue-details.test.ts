import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import type { MusicSource, Track } from '../types/domain'
import { makePlaceholderTrack } from '../lib/lazy-window'

const services = vi.hoisted(() => ({
  netease: { getTracksByIds: vi.fn() },
  qq: { getTracksByIds: vi.fn() },
  apple: { getTracksByIds: vi.fn() },
  local: { getTracksByIds: vi.fn() },
}))
vi.mock('../lib/service-registry', () => ({ serviceFor: (source: MusicSource) => services[source] }))
vi.mock('../lib/track-preload', () => ({ preloadTracks: vi.fn() }))

import { usePlaylistStore } from './playlist'
import { usePlayerStore } from './player'
import { useProviderStore } from './providers'
import { useSettingsStore } from './settings'
import { queueDisplayOrder } from '../lib/queue-display'

function song(id: unknown, source: MusicSource = 'netease'): Track {
  return { provider: source, source, type: 'song', id, name: `歌曲${String(id)}`, artist: '歌手', artists: [] }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe('播放队列可见曲目补详情', () => {
  let loadTrack: MockInstance<ReturnType<typeof usePlayerStore.getState>['loadTrack']>

  beforeEach(() => {
    vi.useFakeTimers()
    for (const [source, service] of Object.entries(services)) {
      service.getTracksByIds.mockReset().mockImplementation(async (ids: unknown[]) => ids.map((id) => song(id, source as MusicSource)))
    }
    useProviderStore.setState({ byId: {
      netease: { enabled: true, auth: 'authenticated' },
      qq: { enabled: true, auth: 'authenticated' },
      apple: { enabled: true, auth: 'authenticated' },
    } })
    useSettingsStore.setState({ playMode: 'order' })
    usePlaylistStore.setState({ queue: [], queueIndex: -1, shuffleOrder: [], queueContextId: null })
    loadTrack = vi.spyOn(usePlayerStore.getState(), 'loadTrack').mockResolvedValue()
  })

  afterEach(() => {
    loadTrack.mockRestore()
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('871 首队列只补全可见占位曲目，按 id 对齐乱序响应且不切歌', async () => {
    const queue = Array.from({ length: 871 }, (_, id) => makePlaceholderTrack(id, 'netease'))
    queue[839] = song(839)
    usePlaylistStore.setState({ queue, queueIndex: 839 })
    services.netease.getTracksByIds.mockResolvedValue([song('840'), song('837'), song('838')])

    await usePlaylistStore.getState().ensureQueueDetails([837, 838, 839, 840])

    expect(services.netease.getTracksByIds).toHaveBeenCalledWith([837, 838, 840])
    expect(usePlaylistStore.getState().queue.slice(837, 841).map((track) => track.name)).toEqual(['歌曲837', '歌曲838', '歌曲839', '歌曲840'])
    expect(usePlaylistStore.getState().queue[836]).toBe(queue[836])
    expect(usePlaylistStore.getState().queueIndex).toBe(839)
    expect(loadTrack).not.toHaveBeenCalled()
  })

  it('随机队列按显示顺序加载，混合来源使用各自服务，包含本地文件', async () => {
    const queue = (['netease', 'qq', 'apple', 'local'] as const).map((source) => makePlaceholderTrack(1, source))
    usePlaylistStore.setState({ queue, queueIndex: 0, shuffleOrder: [3, 2, 1, 0] })
    const display = queueDisplayOrder(4, 0, [3, 2, 1, 0], 'shuffle')

    await usePlaylistStore.getState().ensureQueueDetails(display.indices.slice(0, 3))

    expect(services.netease.getTracksByIds).not.toHaveBeenCalled()
    for (const source of ['qq', 'apple', 'local'] as const) {
      expect(services[source].getTracksByIds).toHaveBeenCalledWith([1])
    }
    expect(usePlaylistStore.getState().queue.map((track) => track.pending)).toEqual([true, undefined, undefined, undefined])
  })

  it('重复可见范围复用在途请求，已补全曲目不重复请求', async () => {
    const request = deferred<Track[]>()
    services.netease.getTracksByIds.mockReturnValue(request.promise)
    usePlaylistStore.setState({ queue: [makePlaceholderTrack(1, 'netease')] })
    const first = usePlaylistStore.getState().ensureQueueDetails([0, 0])
    const second = usePlaylistStore.getState().ensureQueueDetails([0])
    request.resolve([song(1)])
    await Promise.all([first, second])
    await usePlaylistStore.getState().ensureQueueDetails([0])
    expect(services.netease.getTracksByIds).toHaveBeenCalledTimes(1)
  })

  it('重排或移除后按曲目对象补全，不写入原下标', async () => {
    const request = deferred<Track[]>()
    services.netease.getTracksByIds.mockReturnValue(request.promise)
    const queue = [0, 1, 2].map((id) => makePlaceholderTrack(id, 'netease'))
    usePlaylistStore.setState({ queue, queueIndex: 0 })
    const loading = usePlaylistStore.getState().ensureQueueDetails([1, 2])
    usePlaylistStore.getState().moveQueueItem(2, 0)
    usePlaylistStore.getState().removeQueueItem(2)
    request.resolve([song(1), song(2)])
    await loading
    expect(usePlaylistStore.getState().queue).toEqual([song(2), queue[0]])
    expect(usePlaylistStore.getState().queueIndex).toBe(1)
  })

  it('换队列后丢弃旧响应，即使新队列使用相同歌曲 id', async () => {
    const request = deferred<Track[]>()
    services.netease.getTracksByIds.mockReturnValue(request.promise)
    usePlaylistStore.setState({ queue: [makePlaceholderTrack(1, 'netease')] })
    const loading = usePlaylistStore.getState().ensureQueueDetails([0])
    const nextQueue = [makePlaceholderTrack(1, 'netease')]
    usePlaylistStore.setState({ queue: nextQueue })
    request.resolve([song(1)])
    await loading
    expect(usePlaylistStore.getState().queue).toBe(nextQueue)
  })

  it('点击正在补详情的歌曲复用请求，并在重排后仍正确播放', async () => {
    const request = deferred<Track[]>()
    services.netease.getTracksByIds.mockReturnValue(request.promise)
    usePlaylistStore.setState({ queue: [makePlaceholderTrack(1, 'netease'), song(2)], queueContextId: '歌单' })
    const loading = usePlaylistStore.getState().ensureQueueDetails([0])
    usePlaylistStore.getState().playAt(0)
    usePlaylistStore.getState().moveQueueItem(0, 1)
    request.resolve([song(1)])
    await loading
    await vi.waitFor(() => expect(usePlaylistStore.getState().queue[1]).toEqual(song(1)))
    expect(loadTrack).toHaveBeenCalledOnce()
    expect(loadTrack).toHaveBeenCalledWith(makePlaceholderTrack(1, 'netease'), { contextId: '歌单' })
    expect(services.netease.getTracksByIds).toHaveBeenCalledTimes(1)
    expect(usePlaylistStore.getState().queueIndex).toBe(1)
  })

  it('加载期间切歌后，详情补全不能把旧歌曲重新播放', async () => {
    const request = deferred<Track[]>()
    services.netease.getTracksByIds.mockReturnValue(request.promise)
    usePlaylistStore.setState({ queue: [makePlaceholderTrack(1, 'netease'), song(2)] })
    const loading = usePlaylistStore.getState().ensureQueueDetails([0])
    usePlaylistStore.getState().playAt(0)
    usePlaylistStore.getState().playAt(1)
    request.resolve([song(1)])
    await loading
    await Promise.resolve()
    expect(loadTrack).toHaveBeenCalledTimes(2)
    expect(loadTrack).toHaveBeenLastCalledWith(song(2), { contextId: null })
  })

  it('未参与的平台不请求，加载期间登录态变化会丢弃响应', async () => {
    const request = deferred<Track[]>()
    services.netease.getTracksByIds.mockReturnValue(request.promise)
    usePlaylistStore.setState({ queue: [makePlaceholderTrack(1, 'netease'), makePlaceholderTrack(1, 'qq')] })
    useProviderStore.getState().setEnabled('qq', false)
    const queue = usePlaylistStore.getState().queue
    const loading = usePlaylistStore.getState().ensureQueueDetails([0, 1])
    useProviderStore.getState().setAccountState('netease', 'expired')
    useProviderStore.getState().setAccountState('netease', 'authenticated')
    useProviderStore.getState().setEnabled('netease', true)
    request.resolve([song(1)])
    await loading
    expect(services.qq.getTracksByIds).not.toHaveBeenCalled()
    expect(usePlaylistStore.getState().queue).toBe(queue)
    services.netease.getTracksByIds.mockResolvedValue([song(1)])
    await usePlaylistStore.getState().ensureQueueDetails([0])
    expect(usePlaylistStore.getState().queue[0]).toEqual(song(1))
  })

  it('失败或缺失详情仍可重试，不把占位曲目误标为已加载', async () => {
    const queue = [makePlaceholderTrack(1, 'netease')]
    usePlaylistStore.setState({ queue })
    services.netease.getTracksByIds.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([])
    await usePlaylistStore.getState().ensureQueueDetails([0])
    await usePlaylistStore.getState().ensureQueueDetails([0])
    expect(usePlaylistStore.getState().queue).toBe(queue)
    await usePlaylistStore.getState().ensureQueueDetails([0])
    expect(usePlaylistStore.getState().queue[0]).toEqual(song(1))
  })

  it('重新登录后立即启动新请求，旧会话的在途响应不阻塞补全', async () => {
    const oldRequest = deferred<Track[]>()
    const newRequest = deferred<Track[]>()
    services.netease.getTracksByIds.mockReturnValueOnce(oldRequest.promise).mockReturnValueOnce(newRequest.promise)
    usePlaylistStore.setState({ queue: [makePlaceholderTrack(1, 'netease')] })
    const oldLoading = usePlaylistStore.getState().ensureQueueDetails([0])
    useProviderStore.getState().setAccountState('netease', 'expired')
    useProviderStore.getState().setAccountState('netease', 'authenticated')
    useProviderStore.getState().setEnabled('netease', true)
    const newLoading = usePlaylistStore.getState().ensureQueueDetails([0])
    expect(services.netease.getTracksByIds).toHaveBeenCalledTimes(2)
    oldRequest.resolve([song(1)])
    await oldLoading
    const duplicate = usePlaylistStore.getState().ensureQueueDetails([0])
    expect(services.netease.getTracksByIds).toHaveBeenCalledTimes(2)
    newRequest.resolve([song(1)])
    await Promise.all([newLoading, duplicate])
    expect(usePlaylistStore.getState().queue[0]).toEqual(song(1))
  })
})
