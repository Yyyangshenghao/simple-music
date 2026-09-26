import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlaybackCandidate } from '../providers/types'
import type { Track } from '../types/domain'
import type { OfflineCacheStatus } from '../lib/offline-cache'

const h = vi.hoisted(() => ({
  next: vi.fn(),
  abort: vi.fn(),
  post: vi.fn(),
  status: vi.fn(),
  statuses: vi.fn(),
  show: vi.fn(),
}))

vi.mock('../lib/playback-resolver', () => ({
  PlaybackResolver: vi.fn(function () {
    return { next: h.next, abort: h.abort, failureMessage: '候选已耗尽' }
  }),
}))
vi.mock('../lib/api', () => ({ api: { post: h.post } }))
vi.mock('../lib/offline-cache', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/offline-cache')>(),
  fetchOfflineStatus: h.status,
  fetchOfflineStatuses: h.statuses,
}))
vi.mock('./providers', () => ({
  isProviderParticipating: () => true,
  useProviderStore: { getState: () => ({
    playbackOrder: ['qq', 'netease'], preferOriginSource: true, multiSourceFallback: true,
  }) },
}))
vi.mock('./settings', () => ({ useSettingsStore: { getState: () => ({ audioQuality: 'lossless' }) } }))
vi.mock('./toast', () => ({ useToastStore: { getState: () => ({ show: h.show }) } }))

import { useOfflineCacheStore } from './offline-cache'

const track: Track = {
  provider: 'qq', source: 'qq', type: 'song', id: 'origin', name: '歌曲', artist: '歌手', artists: [],
}
const missing: OfflineCacheStatus = { source: 'qq', id: 'origin', state: 'missing' }
const pinned: OfflineCacheStatus = { ...missing, state: 'pinned', entryId: 'entry' }
function candidate(url: string, trial = false): PlaybackCandidate {
  return {
    source: 'netease', track: { ...track, provider: 'netease', source: 'netease', id: 'resolved' },
    quality: { id: 'lossless', label: '无损', rank: 1 }, url, trial,
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe('单曲离线保存会话', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    for (const mock of [h.next, h.abort, h.post, h.status, h.statuses, h.show]) mock.mockReset()
    useOfflineCacheStore.setState({ byKey: {}, job: null })
    h.status.mockResolvedValue(missing)
    h.next.mockResolvedValue(null)
    h.post.mockResolvedValue({ ok: true, status: pinned })
  })

  afterEach(() => vi.useRealTimers())

  it('下载失败后继续下一候选，保存真实音源和音质', async () => {
    h.next.mockResolvedValueOnce(candidate('first')).mockResolvedValueOnce(candidate('second'))
    h.post.mockRejectedValueOnce(new Error('HTTP 502'))
    await useOfflineCacheStore.getState().save(track)
    expect(h.next).toHaveBeenCalledTimes(2)
    expect(h.next).toHaveBeenLastCalledWith('HTTP 502')
    expect(h.post).toHaveBeenLastCalledWith('/api/audio-cache/save', expect.objectContaining({
      url: 'second', cacheKey: 'netease:resolved:lossless',
      origin: expect.objectContaining({ source: 'qq', id: 'origin' }),
      resolved: expect.objectContaining({ source: 'netease', id: 'resolved' }), quality: 'lossless',
    }), undefined, expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(useOfflineCacheStore.getState().job?.status).toBe('done')
  })

  it('试听候选不下载，候选耗尽后结束而不循环', async () => {
    h.next.mockResolvedValueOnce(candidate('trial', true)).mockResolvedValueOnce(candidate('full'))
    h.post.mockRejectedValue(new Error('下载失败'))
    await useOfflineCacheStore.getState().save(track)
    expect(h.post).toHaveBeenCalledTimes(1)
    expect(h.next).toHaveBeenCalledTimes(3)
    expect(useOfflineCacheStore.getState().job?.status).toBe('failed')
  })

  it('完整自动缓存只固定，不重复下载或解析', async () => {
    h.status.mockResolvedValueOnce({ ...pinned, state: 'cached' }).mockResolvedValueOnce(pinned)
    await useOfflineCacheStore.getState().save(track)
    expect(h.next).not.toHaveBeenCalled()
    expect(h.post).toHaveBeenCalledOnce()
    expect(h.post.mock.calls[0][0]).toBe('/api/audio-cache/pin')
  })

  it('连续点击不会同时开启两个保存任务', async () => {
    const lookup = deferred<OfflineCacheStatus>()
    h.status.mockReturnValueOnce(lookup.promise)
    const saving = useOfflineCacheStore.getState().save(track)
    await useOfflineCacheStore.getState().save(track)
    expect(h.status).toHaveBeenCalledOnce()
    lookup.resolve(pinned)
    await saving
  })

  it('取消解析立即释放任务，旧候选迟到不能阻塞或覆盖新保存', async () => {
    const old = deferred<PlaybackCandidate | null>()
    h.next.mockReturnValueOnce(old.promise)
    const saving = useOfflineCacheStore.getState().save(track)
    await vi.waitFor(() => expect(h.next).toHaveBeenCalledOnce())
    useOfflineCacheStore.getState().cancelSave()
    expect(useOfflineCacheStore.getState().job).toBeNull()
    expect(h.abort).toHaveBeenCalledOnce()
    h.status.mockResolvedValueOnce(pinned)
    await useOfflineCacheStore.getState().save(track)
    old.resolve(candidate('late'))
    await saving
    expect(h.post).not.toHaveBeenCalled()
    expect(useOfflineCacheStore.getState().job?.status).toBe('done')
  })

  it('取消下载后迟到的成功响应不得写回状态或提示', async () => {
    const downloaded = deferred<{ status: OfflineCacheStatus }>()
    h.next.mockResolvedValueOnce(candidate('full'))
    h.post.mockReturnValueOnce(downloaded.promise)
    const saving = useOfflineCacheStore.getState().save(track)
    await vi.waitFor(() => expect(h.post).toHaveBeenCalledOnce())
    const signal = h.post.mock.calls[0][3].signal as AbortSignal
    useOfflineCacheStore.getState().cancelSave()
    expect(signal.aborted).toBe(true)
    downloaded.resolve({ status: pinned })
    await saving
    expect(useOfflineCacheStore.getState().job).toBeNull()
    expect(useOfflineCacheStore.getState().byKey['qq:origin']?.state).toBe('missing')
    expect(h.show).not.toHaveBeenCalledWith('已保存到本地')
  })

  it('本地音乐没有保存任务', async () => {
    await useOfflineCacheStore.getState().save({ ...track, source: 'local', provider: 'local' })
    expect(h.status).not.toHaveBeenCalled()
    expect(h.post).not.toHaveBeenCalled()
  })

  it('批量查询不丢弃第 101 首以后的曲目', async () => {
    const tracks = Array.from({ length: 205 }, (_, id) => ({ ...track, id: String(id) }))
    h.statuses.mockResolvedValue(tracks.map((item) => ({ ...missing, id: item.id })))
    await useOfflineCacheStore.getState().ensureMany(tracks)
    expect(h.statuses.mock.calls[0][0]).toHaveLength(205)
    expect(Object.keys(useOfflineCacheStore.getState().byKey)).toHaveLength(205)
  })

  it('清理后旧批量查询迟到不能重新写回离线徽标', async () => {
    const lookup = deferred<OfflineCacheStatus[]>()
    h.statuses.mockReturnValueOnce(lookup.promise)
    const checking = useOfflineCacheStore.getState().ensureMany([track])
    useOfflineCacheStore.getState().invalidate()
    lookup.resolve([pinned])
    await checking
    expect(useOfflineCacheStore.getState().byKey).toEqual({})
  })
})
