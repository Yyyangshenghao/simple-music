import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Playlist, Track } from '../types/domain'

const harness = vi.hoisted(() => ({ skeleton: vi.fn(), album: vi.fn(), details: vi.fn(), session: { current: 0 } }))
vi.mock('react', () => ({
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => void) => effect(),
  useReducer: () => [0, vi.fn()],
  useRef: () => harness.session,
  useState: (value: unknown) => [value, vi.fn()],
}))
vi.mock('../lib/service-registry', () => ({ serviceFor: () => ({ getPlaylistSkeleton: harness.skeleton, getAlbumTracks: harness.album, getTracksByIds: harness.details }) }))
vi.mock('../stores/providers', () => ({
  useProviderStore: () => true,
  isProviderParticipating: () => true,
}))
import { invalidatePlaylistCache, loadPlaylistQueue, useLazyPlaylist } from './useLazyPlaylist'

let id = 0
const song = (id: number): Track => ({ id, source: 'netease', provider: 'netease', type: 'song', name: `歌曲${id}`, artist: '歌手', artists: [] })
async function setup() {
  const playlist: Playlist = { id: ++id, source: 'netease', provider: 'netease', type: 'playlist', name: '测试', cover: '', trackCount: 201, playCount: 0, creator: '' }
  harness.skeleton.mockResolvedValue({ trackIds: Array.from({ length: 201 }, (_, i) => i), tracks: [song(0)] })
  const hook = useLazyPlaylist(playlist)
  await Promise.resolve()
  return hook
}

describe('歌单搜索补齐详情', () => {
  beforeEach(() => {
    harness.skeleton.mockReset()
    harness.details.mockReset().mockImplementation(async (ids: number[]) => ids.map(song))
  })
  it('补齐未浏览窗口，复用缓存并保持完整播放顺序', async () => {
    const hook = await setup()
    await hook.ensureAll(() => false)
    expect(harness.details.mock.calls.map(([ids]) => ids.length)).toEqual([100, 100, 1])
    expect(hook.makeQueue()[200]).toEqual(song(200))
    await hook.ensureAll(() => false)
    expect(harness.details).toHaveBeenCalledTimes(3)
  })
  it('复用可见区域在途请求，搜索不会重复请求同一窗口', async () => {
    const hook = await setup()
    hook.ensureRange(0, 10)
    await hook.ensureAll(() => false)
    expect(harness.details).toHaveBeenCalledTimes(3)
  })
  it('清空搜索后停止后续窗口', async () => {
    const hook = await setup()
    let cancelled = false
    harness.details.mockImplementation(async (ids: number[]) => { cancelled = true; return ids.map(song) })
    await hook.ensureAll(() => cancelled)
    expect(harness.details).toHaveBeenCalledTimes(1)
  })
  it('失败可重试，成功窗口不会重复加载', async () => {
    const hook = await setup()
    harness.details.mockResolvedValueOnce(Array.from({ length: 100 }, (_, i) => song(i))).mockRejectedValueOnce(new Error('offline'))
    await expect(hook.ensureAll(() => false)).rejects.toThrow('offline')
    await hook.ensureAll(() => false)
    expect(harness.details.mock.calls.map(([ids]) => ids[0])).toEqual([0, 100, 100, 200])
  })
})

describe('专辑与歌单缓存身份', () => {
  beforeEach(() => {
    harness.skeleton.mockReset().mockResolvedValue({ trackIds: [1], tracks: [song(1)] })
    harness.album.mockReset().mockResolvedValue([song(2)])
    harness.details.mockReset()
  })

  function collections(): Record<'playlist' | 'album', Playlist> {
    const shared: Playlist = { id: ++id, source: 'netease', provider: 'netease', type: 'playlist', name: '同 ID 集合', cover: '', trackCount: 1, playCount: 0, creator: '' }
    return { playlist: shared, album: { ...shared, type: 'album' } }
  }

  it.each(['playlist', 'album'] as const)('hook 先加载 %s 后，同 ID 的另一类型仍返回自己的曲目', async (firstType) => {
    const items = collections()
    const secondType = firstType === 'playlist' ? 'album' : 'playlist'
    const first = useLazyPlaylist(items[firstType])
    await Promise.resolve()
    const second = useLazyPlaylist(items[secondType])
    await Promise.resolve()

    expect(first.makeQueue().map(track => track.id)).toEqual(firstType === 'playlist' ? [1] : [2])
    expect(second.makeQueue().map(track => track.id)).toEqual(secondType === 'playlist' ? [1] : [2])
    expect((await loadPlaylistQueue(items.playlist)).map(track => track.id)).toEqual([1])
    expect((await loadPlaylistQueue(items.album)).map(track => track.id)).toEqual([2])
    expect(harness.skeleton).toHaveBeenCalledTimes(1)
    expect(harness.album).toHaveBeenCalledTimes(1)
  })

  it.each(['playlist', 'album'] as const)('命令式先加载 %s 后，两种类型独立缓存并各自复用', async (firstType) => {
    const items = collections()
    const secondType = firstType === 'playlist' ? 'album' : 'playlist'
    await loadPlaylistQueue(items[firstType])
    await loadPlaylistQueue(items[secondType])

    expect((await loadPlaylistQueue(items.playlist)).map(track => track.id)).toEqual([1])
    expect((await loadPlaylistQueue(items.album)).map(track => track.id)).toEqual([2])
    expect(harness.skeleton).toHaveBeenCalledTimes(1)
    expect(harness.album).toHaveBeenCalledTimes(1)
  })

  it.each(['playlist', 'album'] as const)('失效 %s 不影响同 ID 的另一类型缓存', async (invalidatedType) => {
    const items = collections()
    await loadPlaylistQueue(items.playlist)
    await loadPlaylistQueue(items.album)
    harness.skeleton.mockResolvedValue({ trackIds: [3], tracks: [song(3)] })
    harness.album.mockResolvedValue([song(4)])

    invalidatePlaylistCache(items[invalidatedType])

    expect((await loadPlaylistQueue(items.playlist)).map(track => track.id)).toEqual(invalidatedType === 'playlist' ? [3] : [1])
    expect((await loadPlaylistQueue(items.album)).map(track => track.id)).toEqual(invalidatedType === 'album' ? [4] : [2])
    expect(harness.skeleton).toHaveBeenCalledTimes(invalidatedType === 'playlist' ? 2 : 1)
    expect(harness.album).toHaveBeenCalledTimes(invalidatedType === 'album' ? 2 : 1)
  })
})

describe('推荐曲目缓存更新', () => {
  beforeEach(() => {
    harness.skeleton.mockReset()
    harness.album.mockReset()
    harness.details.mockReset()
  })

  function recommendation(): Playlist {
    return { id: `daily:${++id}`, source: 'netease', provider: 'netease', type: 'playlist', name: '每日推荐', cover: '', trackCount: 4, playCount: 0, creator: '' }
  }

  it.each([
    { name: '中间换歌', update: (tracks: Track[]) => [tracks[0], song(9), tracks[2], tracks[3]] },
    { name: '中间重排', update: (tracks: Track[]) => [tracks[0], tracks[2], tracks[1], tracks[3]] },
    { name: '同 ID 元数据更新', update: (tracks: Track[]) => [tracks[0], { ...tracks[1], name: '更新标题', cover: 'https://example.com/new-cover.jpg' }, tracks[2], tracks[3]] },
  ])('同长度且首尾不变时仍同步$name', ({ update }) => {
    const item = recommendation()
    const original = [song(1), song(2), song(3), song(4)]
    const first = useLazyPlaylist(item, original)
    const updated = update(original)
    const current = useLazyPlaylist(item, updated)

    expect(current.tracks).toEqual(updated)
    expect(current.makeQueue()).toEqual(updated)
    expect(first.makeQueue()[1]).toBe(updated[1])
    expect(harness.skeleton).not.toHaveBeenCalled()
    expect(harness.album).not.toHaveBeenCalled()
    expect(harness.details).not.toHaveBeenCalled()
  })

  it('重复渲染或仅复制数组时复用未变化曲目，不请求上游', async () => {
    const item = recommendation()
    const tracks = [song(1), song(2), song(3), song(4)]
    const first = useLazyPlaylist(item, tracks)
    expect(useLazyPlaylist(item, tracks).tracks).toBe(first.tracks)
    const current = useLazyPlaylist(item, [...tracks])
    expect(current.tracks).toBe(first.tracks)
    await current.ensureAll(() => false)

    expect(current.makeQueue()).toEqual(tracks)
    expect(harness.skeleton).not.toHaveBeenCalled()
    expect(harness.album).not.toHaveBeenCalled()
    expect(harness.details).not.toHaveBeenCalled()
  })
})
