import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Playlist, Track } from '../types/domain'

const harness = vi.hoisted(() => ({ skeleton: vi.fn(), album: vi.fn(), details: vi.fn(), session: { current: 0 }, participating: true, likes: { qqMutationRevision: 0 } }))
vi.mock('react', () => ({
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => void) => effect(),
  useReducer: () => [0, vi.fn()],
  useRef: (value: unknown) => value === 0 ? harness.session : { current: value },
  useState: (value: unknown) => [value, vi.fn()],
}))
vi.mock('../stores/likes', () => ({
  useLikesStore: Object.assign(
    (select: (state: typeof harness.likes) => unknown) => select(harness.likes),
    { getState: () => harness.likes }
  ),
}))
vi.mock('../lib/service-registry', () => ({ serviceFor: () => ({ getPlaylistSkeleton: harness.skeleton, getAlbumTracks: harness.album, getTracksByIds: harness.details }) }))
vi.mock('../stores/providers', () => ({
  useProviderStore: (select: (state: unknown) => unknown) => select({ byId: {
    netease: { enabled: true, auth: 'authenticated' }, qq: { enabled: true, auth: 'authenticated' }, apple: { enabled: true, auth: 'authenticated' },
  } }),
  isProviderParticipating: () => harness.participating,
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
  afterEach(() => vi.restoreAllMocks())
  beforeEach(() => {
    harness.participating = true
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
  it('滚动反复经过限流窗口不会立即重试，冷却后仍可补齐', async () => {
    let now = 1000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const hook = await setup()
    harness.details.mockRejectedValueOnce(new Error('操作过多'))
    hook.ensureRange(100, 120)
    for (let i = 0; i < 10; i++) await Promise.resolve()
    hook.ensureRange(100, 125)
    expect(harness.details).toHaveBeenCalledTimes(1)
    now += 30_001
    hook.ensureRange(100, 130)
    for (let i = 0; i < 10; i++) await Promise.resolve()
    expect(harness.details).toHaveBeenCalledTimes(2)
    expect(hook.makeQueue()[100]).toEqual(song(100))
  })
  it('停用期间完成的旧请求不让重新启用后的窗口进入失败冷却', async () => {
    const hook = await setup()
    let finish!: (tracks: Track[]) => void
    harness.details.mockReturnValueOnce(new Promise<Track[]>(resolve => { finish = resolve }))
    hook.ensureRange(100, 120)
    harness.participating = false
    finish([song(100)])
    for (let i = 0; i < 10; i++) await Promise.resolve()
    harness.participating = true
    hook.ensureRange(100, 120)
    for (let i = 0; i < 10; i++) await Promise.resolve()
    expect(harness.details).toHaveBeenCalledTimes(2)
    expect(hook.makeQueue()[100]).toEqual(song(100))
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

describe('QQ 红心写后歌单缓存', () => {
  let mutationRevision = 0
  const liked: Playlist = { id: 'qq-liked:201', source: 'qq', provider: 'qq', type: 'playlist', name: '我喜欢的音乐', cover: '', trackCount: 1, playCount: 0, creator: '' }
  const qqSong = (id: number): Track => ({ ...song(id), source: 'qq', provider: 'qq' })
  const skeleton = (id: number) => ({ trackIds: [id], tracks: [qqSong(id)] })

  beforeEach(() => {
    mutationRevision += 2
    harness.likes.qqMutationRevision = mutationRevision
    harness.participating = true
    invalidatePlaylistCache(liked)
    harness.skeleton.mockReset().mockResolvedValue(skeleton(1))
    harness.details.mockReset()
  })

  it('我喜欢的音乐在同版本复用队列，写成功后重新读取并缓存新曲目', async () => {
    expect(await loadPlaylistQueue(liked)).toEqual([qqSong(1)])
    expect(await loadPlaylistQueue(liked)).toEqual([qqSong(1)])
    expect(harness.skeleton).toHaveBeenCalledTimes(1)

    harness.likes.qqMutationRevision++
    harness.skeleton.mockResolvedValue(skeleton(2))
    expect(await loadPlaylistQueue(liked)).toEqual([qqSong(2)])
    expect(await loadPlaylistQueue(liked)).toEqual([qqSong(2)])
    expect(harness.skeleton).toHaveBeenCalledTimes(2)
  })

  it('普通 QQ 歌单不因红心写成功而重拉骨架', async () => {
    const playlist: Playlist = { ...liked, id: `qq:${++id}`, name: '普通歌单' }
    expect(await loadPlaylistQueue(playlist)).toEqual([qqSong(1)])
    harness.likes.qqMutationRevision++
    harness.skeleton.mockResolvedValue(skeleton(2))

    expect(await loadPlaylistQueue(playlist)).toEqual([qqSong(1)])
    expect(harness.skeleton).toHaveBeenCalledTimes(1)
  })

  it('我喜欢的音乐 hook 在写成功后使用新曲目，与命令式队列共享缓存', async () => {
    const first = useLazyPlaylist(liked)
    await Promise.resolve()
    expect(first.makeQueue()).toEqual([qqSong(1)])
    harness.likes.qqMutationRevision++
    harness.skeleton.mockResolvedValue(skeleton(2))
    const current = useLazyPlaylist(liked)
    await Promise.resolve()

    expect(current.makeQueue()).toEqual([qqSong(2)])
    expect(await loadPlaylistQueue(liked)).toEqual([qqSong(2)])
    expect(harness.skeleton).toHaveBeenCalledTimes(2)
  })

  it('写入前的队列响应迟到不能覆盖成功后新版本的曲目', async () => {
    let finish!: (value: ReturnType<typeof skeleton>) => void
    harness.skeleton.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const oldRequest = loadPlaylistQueue(liked)
    const oldResult = expect(oldRequest).rejects.toThrow('歌单加载会话已失效')
    harness.likes.qqMutationRevision++
    harness.skeleton.mockResolvedValue(skeleton(2))
    expect(await loadPlaylistQueue(liked)).toEqual([qqSong(2)])

    finish(skeleton(1))
    await oldResult

    expect(await loadPlaylistQueue(liked)).toEqual([qqSong(2)])
    expect(harness.skeleton).toHaveBeenCalledTimes(2)
  })

  it('写入前 hook 的骨架响应迟到也不会污染新版本缓存', async () => {
    let finish!: (value: ReturnType<typeof skeleton>) => void
    harness.skeleton.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    useLazyPlaylist(liked)
    harness.likes.qqMutationRevision++
    harness.skeleton.mockResolvedValue(skeleton(2))
    const current = useLazyPlaylist(liked)
    await Promise.resolve()
    finish(skeleton(1))
    await Promise.resolve()

    expect(current.makeQueue()).toEqual([qqSong(2)])
    expect(await loadPlaylistQueue(liked)).toEqual([qqSong(2)])
    expect(harness.skeleton).toHaveBeenCalledTimes(2)
  })
})
