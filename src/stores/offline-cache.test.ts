import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlaybackCandidate } from '../providers/types'
import type { Track } from '../types/domain'
import type { OfflineCacheStatus } from '../lib/offline-cache'

const h = vi.hoisted(() => ({
  next: vi.fn(),
  abort: vi.fn(),
  post: vi.fn(),
  get: vi.fn(),
  details: vi.fn(),
  status: vi.fn(),
  statuses: vi.fn(),
  show: vi.fn(),
}))

vi.mock('../lib/playback-resolver', () => ({
  PlaybackResolver: vi.fn(function () {
    return { next: h.next, abort: h.abort, failureMessage: '候选已耗尽' }
  }),
}))
vi.mock('../lib/api', () => ({ api: { post: h.post, get: h.get } }))
vi.mock('../providers/registry', () => ({ providerFor: () => ({ catalog: { getTracksByIds: h.details } }) }))
vi.mock('../lib/provider-account-session', () => ({ providerAccountSession: () => 0 }))
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

import { OFFLINE_SAVE_HISTORY_LIMIT, useOfflineCacheStore } from './offline-cache'

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
    for (const mock of [h.next, h.abort, h.post, h.get, h.details, h.status, h.statuses, h.show]) mock.mockReset()
    useOfflineCacheStore.setState({ byKey: {}, jobs: [], paused: false, downloadDir: '/downloads', directoryError: '', queueOpen: false })
    h.status.mockResolvedValue(missing)
    h.next.mockResolvedValue(null)
    h.get.mockResolvedValue({ dir: '/downloads' })
    h.post.mockImplementation(async (path: string) => path === '/api/downloads/export' ? { filePath: '/downloads/歌手 - 歌曲.mp3', size: 100 } : { ok: true, status: pinned })
  })

  afterEach(() => vi.useRealTimers())

  it('下载失败后继续下一候选，保存真实音源和音质', async () => {
    h.next.mockResolvedValueOnce(candidate('first')).mockResolvedValueOnce(candidate('second'))
    h.post.mockRejectedValueOnce(new Error('HTTP 502'))
    await useOfflineCacheStore.getState().save(track)
    expect(h.next).toHaveBeenCalledTimes(2)
    expect(h.next).toHaveBeenLastCalledWith('HTTP 502')
    expect(h.post).toHaveBeenNthCalledWith(2, '/api/audio-cache/save', expect.objectContaining({
      url: 'second', cacheKey: 'netease:resolved:lossless',
      origin: expect.objectContaining({ source: 'qq', id: 'origin' }),
      resolved: expect.objectContaining({ source: 'netease', id: 'resolved' }), quality: 'lossless',
    }), undefined, expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(useOfflineCacheStore.getState().jobs.at(-1)?.status).toBe('done')
  })

  it('试听候选不下载，候选耗尽后结束而不循环', async () => {
    h.next.mockResolvedValueOnce(candidate('trial', true)).mockResolvedValueOnce(candidate('full'))
    h.post.mockRejectedValue(new Error('下载失败'))
    await useOfflineCacheStore.getState().save(track)
    expect(h.post).toHaveBeenCalledTimes(1)
    expect(h.next).toHaveBeenCalledTimes(3)
    expect(useOfflineCacheStore.getState().jobs.at(-1)?.status).toBe('failed')
  })

  it('完整自动缓存只固定，不重复下载或解析', async () => {
    h.status.mockResolvedValueOnce({ ...pinned, state: 'cached' }).mockResolvedValueOnce(pinned)
    await useOfflineCacheStore.getState().save(track)
    expect(h.next).not.toHaveBeenCalled()
    expect(h.post).toHaveBeenCalledTimes(2)
    expect(h.post.mock.calls[0][0]).toBe('/api/audio-cache/pin')
    expect(h.post.mock.calls[1][0]).toBe('/api/downloads/export')
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

  it('同时保存三首，第四首排队，完成后立即补位', async () => {
    const lookups = Array.from({ length: 4 }, () => deferred<OfflineCacheStatus>())
    lookups.forEach((lookup) => h.status.mockReturnValueOnce(lookup.promise))
    const saves = lookups.map((_, id) => useOfflineCacheStore.getState().save({ ...track, id: String(id) }))
    expect(h.status).toHaveBeenCalledTimes(3)
    expect(useOfflineCacheStore.getState().jobs.map((job) => job.status)).toEqual(['resolving', 'resolving', 'resolving', 'queued'])
    lookups[1].resolve(pinned)
    await saves[1]
    expect(h.status).toHaveBeenCalledTimes(4)
    lookups.forEach((lookup) => lookup.resolve(pinned))
    await Promise.all(saves)
    expect(useOfflineCacheStore.getState().jobs.every((job) => job.status === 'done')).toBe(true)
  })

  it('取消排队任务不会发请求，取消单个下载不影响其他任务', async () => {
    const lookup = deferred<OfflineCacheStatus>()
    h.status.mockReturnValue(lookup.promise)
    const saves = Array.from({ length: 4 }, (_, id) => useOfflineCacheStore.getState().save({ ...track, id: String(id) }))
    useOfflineCacheStore.getState().cancelSave('qq:3')
    await saves[3]
    expect(h.status).toHaveBeenCalledTimes(3)
    useOfflineCacheStore.getState().cancelSave('qq:1')
    expect(useOfflineCacheStore.getState().jobs.map((job) => String(job.track.id))).toEqual(['0', '2'])
    lookup.resolve(pinned)
    await Promise.all(saves)
  })

  it('取消解析立即释放任务，旧候选迟到不能阻塞或覆盖新保存', async () => {
    const old = deferred<PlaybackCandidate | null>()
    h.next.mockReturnValueOnce(old.promise)
    const saving = useOfflineCacheStore.getState().save(track)
    await vi.waitFor(() => expect(h.next).toHaveBeenCalledOnce())
    useOfflineCacheStore.getState().cancelSave()
    expect(useOfflineCacheStore.getState().jobs).toEqual([])
    expect(h.abort).toHaveBeenCalledOnce()
    h.status.mockResolvedValueOnce(pinned)
    await useOfflineCacheStore.getState().save(track)
    old.resolve(candidate('late'))
    await saving
    expect(h.post).toHaveBeenCalledOnce()
    expect(h.post.mock.calls[0][0]).toBe('/api/downloads/export')
    expect(useOfflineCacheStore.getState().jobs.at(-1)?.status).toBe('done')
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
    expect(useOfflineCacheStore.getState().jobs).toEqual([])
    expect(useOfflineCacheStore.getState().byKey['qq:origin']?.state).toBe('missing')
    expect(h.show).not.toHaveBeenCalledWith('已保存到本地')
  })

  it.each(['local', 'apple'] as const)('%s 没有保存任务，不进入普通音源解析', async (source) => {
    await useOfflineCacheStore.getState().save({ ...track, source, provider: source })
    expect(h.status).not.toHaveBeenCalled()
    expect(h.post).not.toHaveBeenCalled()
  })

  it('批量成功的后续任务不会掩盖失败，完成历史保持上限', async () => {
    const controller = new AbortController()
    useOfflineCacheStore.setState({ jobs: [{ track: { ...track, id: 'failed' }, status: 'failed', controller, directory: '/downloads', error: '失败' }] })
    h.status.mockResolvedValue(pinned)
    for (let id = 0; id < OFFLINE_SAVE_HISTORY_LIMIT + 10; id++) await useOfflineCacheStore.getState().save({ ...track, id: String(id) })
    const jobs = useOfflineCacheStore.getState().jobs
    expect(jobs).toHaveLength(OFFLINE_SAVE_HISTORY_LIMIT)
    expect(jobs.some((job) => job.status === 'failed' && job.track.id === 'failed')).toBe(true)
  })

  it('已有失败历史时，并发产生的新失败仍保留重试入口', async () => {
    useOfflineCacheStore.setState({ jobs: Array.from({ length: OFFLINE_SAVE_HISTORY_LIMIT - 1 }, (_, id) => ({
      track: { ...track, id: `old-${id}` }, status: 'failed', controller: new AbortController(), directory: '/downloads',
    })) })
    await Promise.all(Array.from({ length: 3 }, (_, id) => useOfflineCacheStore.getState().save({ ...track, id: `new-${id}` })))
    const jobs = useOfflineCacheStore.getState().jobs
    expect(jobs).toHaveLength(OFFLINE_SAVE_HISTORY_LIMIT)
    for (let id = 0; id < 3; id++) expect(jobs.some((job) => job.status === 'failed' && job.track.id === `new-${id}`)).toBe(true)
    expect(jobs.some((job) => job.track.id === 'old-0')).toBe(false)
  })

  it('批量查询不丢弃第 101 首以后的曲目', async () => {
    const tracks = Array.from({ length: 205 }, (_, id) => ({ ...track, id: String(id) }))
    h.statuses.mockResolvedValue(tracks.map((item) => ({ ...missing, id: item.id })))
    await useOfflineCacheStore.getState().ensureMany(tracks)
    expect(h.statuses.mock.calls[0][0]).toHaveLength(205)
    expect(Object.keys(useOfflineCacheStore.getState().byKey)).toHaveLength(205)
  })

  it('批量加入立即形成等待队列，暂停阻止起步，继续后仍只有三首并发', async () => {
    const lookup = deferred<OfflineCacheStatus>()
    h.status.mockReturnValue(lookup.promise)
    useOfflineCacheStore.getState().setPaused(true)
    const tracks = Array.from({ length: 5 }, (_, id) => ({ ...track, id: String(id) }))
    expect(await useOfflineCacheStore.getState().saveMany([...tracks, tracks[0], { ...track, source: 'apple' }, { ...track, id: 'blocked', playable: false }])).toBe(5)
    expect(h.status).not.toHaveBeenCalled()
    expect(useOfflineCacheStore.getState().jobs.every((job) => job.status === 'queued')).toBe(true)
    useOfflineCacheStore.getState().setQueueOpen(false)
    expect(useOfflineCacheStore.getState().jobs).toHaveLength(5)
    useOfflineCacheStore.getState().setPaused(false)
    expect(h.status).toHaveBeenCalledTimes(3)
    useOfflineCacheStore.getState().cancelSave()
    lookup.resolve(pinned)
  })

  it('更改目录只影响新任务，旧等待任务保留原目录', async () => {
    useOfflineCacheStore.getState().setPaused(true)
    await useOfflineCacheStore.getState().saveMany([track])
    h.post.mockResolvedValueOnce({ dir: '/new-downloads' })
    await useOfflineCacheStore.getState().setDownloadDir('/new-downloads')
    await useOfflineCacheStore.getState().saveMany([{ ...track, id: 'new' }])
    expect(useOfflineCacheStore.getState().jobs.map((job) => job.directory)).toEqual(['/downloads', '/new-downloads'])
    useOfflineCacheStore.getState().cancelSave()
  })

  it('缓存固定完成后还要写出歌曲文件，导出失败重试不重复下载', async () => {
    h.status.mockResolvedValue(pinned)
    h.post.mockRejectedValueOnce(new Error('磁盘不可写'))
    await useOfflineCacheStore.getState().save(track)
    expect(useOfflineCacheStore.getState().jobs.at(-1)).toMatchObject({ status: 'failed', error: '磁盘不可写' })
    expect(h.next).not.toHaveBeenCalled()
    await useOfflineCacheStore.getState().save(track)
    expect(useOfflineCacheStore.getState().jobs.at(-1)).toMatchObject({ status: 'done', filePath: '/downloads/歌手 - 歌曲.mp3' })
    expect(h.post.mock.calls.every((call) => call[0] === '/api/downloads/export')).toBe(true)
  })

  it('歌单占位曲目在下载前补全详情，再用真实名称导出', async () => {
    h.details.mockResolvedValue([{ ...track, name: '完整歌曲名', pending: false }])
    h.status.mockResolvedValue(pinned)
    await useOfflineCacheStore.getState().save({ ...track, pending: true, name: '占位' })
    expect(h.details).toHaveBeenCalledWith(['origin'])
    expect(h.post).toHaveBeenCalledWith('/api/downloads/export', expect.objectContaining({ origin: expect.objectContaining({ name: '完整歌曲名' }) }), undefined, expect.anything())
  })

  it('取消导出时不接受迟到的文件完成结果', async () => {
    h.status.mockResolvedValue(pinned)
    const exporting = deferred<{ filePath: string; size: number }>()
    h.post.mockReturnValueOnce(exporting.promise)
    const saving = useOfflineCacheStore.getState().save(track)
    await vi.waitFor(() => expect(useOfflineCacheStore.getState().jobs[0].status).toBe('exporting'))
    useOfflineCacheStore.getState().cancelSave()
    exporting.resolve({ filePath: '/downloads/late.mp3', size: 10 })
    await saving
    expect(useOfflineCacheStore.getState().jobs).toEqual([])
  })

  it.each(['operation', 'queue'] as const)('首次目录请求慢时，取消 %s 后不会让旧批量任务迟到入队', async (kind) => {
    useOfflineCacheStore.setState({ downloadDir: '' })
    const directory = deferred<{ dir: string }>()
    h.get.mockReturnValueOnce(directory.promise)
    const controller = new AbortController()
    const adding = useOfflineCacheStore.getState().saveMany([track], controller.signal)
    if (kind === 'operation') controller.abort()
    else useOfflineCacheStore.getState().cancelSave()
    directory.resolve({ dir: '/downloads' })
    await expect(adding).rejects.toMatchObject({ name: 'AbortError' })
    expect(useOfflineCacheStore.getState().jobs).toEqual([])
    expect(h.status).not.toHaveBeenCalled()
  })

  it('成功选择目录后，旧初始目录请求失败不能恢复错误横幅', async () => {
    useOfflineCacheStore.setState({ downloadDir: '' })
    let reject!: (error: Error) => void
    h.get.mockReturnValueOnce(new Promise((_, failure) => { reject = failure }))
    const loading = useOfflineCacheStore.getState().loadDownloadDir()
    h.post.mockResolvedValueOnce({ dir: '/new-downloads' })
    await useOfflineCacheStore.getState().setDownloadDir('/new-downloads')
    reject(new Error('旧请求失败'))
    await expect(loading).resolves.toBe('/new-downloads')
    expect(useOfflineCacheStore.getState().directoryError).toBe('')
  })

  it('浏览大量歌曲后只保留有限的近期离线状态', async () => {
    const tracks = Array.from({ length: 2300 }, (_, id) => ({ ...track, id: String(id) }))
    h.statuses.mockResolvedValue(tracks.map((item) => ({ ...missing, id: item.id })))
    await useOfflineCacheStore.getState().ensureMany(tracks)
    const statuses = useOfflineCacheStore.getState().byKey
    expect(Object.keys(statuses).length).toBeLessThanOrEqual(2048)
    expect(statuses['qq:0']).toBeUndefined()
    expect(statuses['qq:2299']).toBeDefined()
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
