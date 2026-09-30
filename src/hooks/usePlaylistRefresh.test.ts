import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Playlist, Track } from '../types/domain'

const harness = vi.hoisted(() => ({ skeleton: vi.fn(), revision: vi.fn(), details: vi.fn() }))
vi.mock('react', () => ({
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => void) => effect(),
  useReducer: () => [0, vi.fn()],
  useRef: () => ({ current: 0 }),
  useState: (value: unknown) => [value, vi.fn()],
}))
vi.mock('../lib/service-registry', () => ({ serviceFor: () => ({
  getPlaylistSkeleton: harness.skeleton,
  getPlaylistRevision: harness.revision,
  getTracksByIds: harness.details,
}) }))
vi.mock('../stores/providers', () => ({ useProviderStore: () => true, isProviderParticipating: () => true }))
import { useLazyPlaylist } from './useLazyPlaylist'

let id = 0
const song = (id: number): Track => ({ id, source: 'netease', provider: 'netease', type: 'song', name: `歌曲${id}`, artist: '歌手', artists: [] })
const playlist = (): Playlist => ({ id: ++id, source: 'netease', provider: 'netease', type: 'playlist', name: '测试', cover: '', trackCount: 2, playCount: 0, creator: '' })

async function setup() {
  const item = playlist()
  harness.skeleton.mockResolvedValue({ trackIds: [1, 2], tracks: [song(1), song(2)], updatedAt: 1 })
  const hook = useLazyPlaylist(item)
  await Promise.resolve()
  return { hook, item }
}

describe('歌单内容刷新', () => {
  beforeEach(() => {
    harness.skeleton.mockReset()
    harness.revision.mockReset()
    harness.details.mockReset()
  })

  it('再次进入已缓存歌单时先轻量检查', async () => {
    const { item } = await setup()
    harness.revision.mockResolvedValue({ trackIds: [1, 2], updatedAt: 1 })
    useLazyPlaylist(item)
    expect(harness.revision).toHaveBeenCalledTimes(1)
    expect(harness.skeleton).toHaveBeenCalledTimes(1)
  })

  it('更新时间变化时重新加载曲目并更新播放队列', async () => {
    const { hook } = await setup()
    harness.revision.mockResolvedValue({ trackIds: [1, 2], updatedAt: 2 })
    harness.skeleton.mockResolvedValueOnce({ trackIds: [2, 1], tracks: [song(2), song(1)], updatedAt: 2 })
    await hook.checkForUpdates()
    expect(hook.makeQueue().map((track) => track.id)).toEqual([2, 1])
    expect(harness.skeleton).toHaveBeenCalledTimes(2)
  })

  it('时间戳缺失时仍能发现同数量歌曲换序', async () => {
    const { hook } = await setup()
    harness.revision.mockResolvedValue({ trackIds: [2, 1], updatedAt: null })
    harness.skeleton.mockResolvedValueOnce({ trackIds: [2, 1], tracks: [song(2), song(1)], updatedAt: null })
    await hook.checkForUpdates()
    expect(hook.makeQueue().map((track) => track.id)).toEqual([2, 1])
  })

  it('刷新失败时保留旧歌曲', async () => {
    const { hook } = await setup()
    harness.skeleton.mockRejectedValueOnce(new Error('offline'))
    await expect(hook.refresh()).rejects.toThrow('offline')
    expect(hook.makeQueue().map((track) => track.id)).toEqual([1, 2])
  })

  it('仍在打开的歌单被 LRU 淘汰后可以重新获取', async () => {
    const { hook } = await setup()
    for (let i = 0; i < 4; i++) {
      useLazyPlaylist(playlist())
      await Promise.resolve()
    }
    harness.skeleton.mockResolvedValueOnce({ trackIds: [9], tracks: [song(9)], updatedAt: 2 })
    await hook.refresh()
    expect(hook.makeQueue().map((track) => track.id)).toEqual([9])
  })

  it('初次加载失败后再次进入会自动重试', async () => {
    const item = playlist()
    harness.skeleton.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ trackIds: [9], tracks: [song(9)], updatedAt: 2 })
    useLazyPlaylist(item)
    await Promise.resolve()
    await Promise.resolve()
    useLazyPlaylist(item)
    expect(harness.skeleton).toHaveBeenCalledTimes(2)
  })

  it('两个视图同时刷新时较旧响应不会覆盖较新结果', async () => {
    const { hook: first, item } = await setup()
    harness.revision.mockResolvedValue({ trackIds: [1, 2], updatedAt: 1 })
    const second = useLazyPlaylist(item)
    let resolveOld!: (value: { trackIds: number[]; tracks: Track[] }) => void
    harness.skeleton.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve }))
    const oldRequest = first.refresh()
    harness.skeleton.mockResolvedValueOnce({ trackIds: [3], tracks: [song(3)] })
    await second.refresh()
    resolveOld({ trackIds: [4], tracks: [song(4)] })
    await oldRequest
    expect(first.makeQueue().map((track) => track.id)).toEqual([3])
  })
})
