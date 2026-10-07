import { beforeEach, describe, expect, it, vi } from 'vitest'
import { deleteOfflineLibraryItems, filterOfflineLibrary, offlineLibraryTrack, type OfflineLibraryItem } from './offline-library'

const h = vi.hoisted(() => ({ post: vi.fn() }))
vi.mock('./api', () => ({ api: { post: h.post } }))
beforeEach(() => { h.post.mockReset(); h.post.mockResolvedValue({ ok: true }) })

const items: OfflineLibraryItem[] = [
  { origin: { source: 'netease', id: '1', name: 'B song', artist: 'Amy', album: 'Summer', duration: 120000 }, entryId: 'one', savedAt: 10, size: 4, quality: 'standard' },
  { origin: { source: 'qq', id: '1', name: 'A song', artist: 'Bob' }, entryId: 'two', savedAt: 20, size: 4, quality: 'lossless' },
]

describe('离线音乐列表和播放队列', () => {
  it('搜索标题、艺人、专辑，忽略空白与大小写', () => {
    expect(filterOfflineLibrary(items, ' SONG ', 'savedAt')).toEqual([items[1], items[0]])
    expect(filterOfflineLibrary(items, 'amy', 'name')).toEqual([items[0]])
    expect(filterOfflineLibrary(items, 'summer', 'name')).toEqual([items[0]])
    expect(filterOfflineLibrary(items, 'missing', 'savedAt')).toEqual([])
  })
  it('按标题、艺人或保存时间排序，不改变原始列表', () => {
    expect(filterOfflineLibrary(items, '', 'name')).toEqual([items[1], items[0]])
    expect(filterOfflineLibrary(items, '', 'artist')).toEqual(items)
    expect(items[0].entryId).toBe('one')
  })
  it('播放队列遵循当前筛选顺序，保留跨平台同 ID 和毫秒时长', () => {
    const queue = filterOfflineLibrary(items, '', 'savedAt').map(offlineLibraryTrack)
    expect(queue.map((track) => `${track.source}:${track.id}`)).toEqual(['qq:1', 'netease:1'])
    expect(queue[1]).toMatchObject({ provider: 'netease', type: 'song', name: 'B song', duration: 120000 })
    expect(queue[1].url).toBeUndefined()
  })
  it('旧索引资料缺失时仍保留可播放身份', () => {
    expect(offlineLibraryTrack({ ...items[0], origin: { source: 'qq', id: 'old' } })).toMatchObject({ source: 'qq', id: 'old', name: '未知歌曲', artist: '未知艺人' })
  })

  it('批量删除按来源和 ID 去重，传递已确认的保存时间与文件归属', async () => {
    const signal = new AbortController().signal
    const result = await deleteOfflineLibraryItems([items[0], items[0], items[1]], signal)
    expect(result).toEqual({ removed: items, failed: [], cancelled: false })
    expect(h.post).toHaveBeenCalledTimes(2)
    expect(h.post).toHaveBeenNthCalledWith(1, '/api/audio-cache/delete', {
      entryId: items[0].entryId, origin: items[0].origin, savedAt: items[0].savedAt,
    }, undefined, { signal })
  })

  it('部分失败继续删除其余项并返回失败项供界面重试', async () => {
    h.post.mockRejectedValueOnce(new Error('HTTP 409'))
    expect(await deleteOfflineLibraryItems(items, new AbortController().signal)).toEqual({ removed: [items[1]], failed: [items[0]], cancelled: false })
    expect(h.post).toHaveBeenCalledTimes(2)
  })

  it('取消操作后不开始后续请求，并保留已成功删除的结果', async () => {
    const controller = new AbortController()
    h.post.mockImplementationOnce(async () => { controller.abort(); return { ok: true } })
    expect(await deleteOfflineLibraryItems(items, controller.signal)).toEqual({ removed: [items[0]], failed: [], cancelled: true })
    expect(h.post).toHaveBeenCalledTimes(1)
    h.post.mockClear()
    expect(await deleteOfflineLibraryItems(items, controller.signal)).toEqual({ removed: [], failed: [], cancelled: true })
    expect(h.post).not.toHaveBeenCalled()
  })

  it('取消中的请求失败不误报删除成功，也不继续下一首', async () => {
    const controller = new AbortController()
    h.post.mockImplementationOnce(async () => { controller.abort(); throw new DOMException('Aborted', 'AbortError') })
    expect(await deleteOfflineLibraryItems(items, controller.signal)).toEqual({ removed: [], failed: [], cancelled: true })
    expect(h.post).toHaveBeenCalledTimes(1)
  })
})
