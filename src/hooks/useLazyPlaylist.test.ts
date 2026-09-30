import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Playlist, Track } from '../types/domain'

const harness = vi.hoisted(() => ({ skeleton: vi.fn(), details: vi.fn(), session: { current: 0 } }))
vi.mock('react', () => ({
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => void) => effect(),
  useReducer: () => [0, vi.fn()],
  useRef: () => harness.session,
  useState: (value: unknown) => [value, vi.fn()],
}))
vi.mock('../lib/service-registry', () => ({ serviceFor: () => ({ getPlaylistSkeleton: harness.skeleton, getTracksByIds: harness.details }) }))
vi.mock('../stores/providers', () => ({
  useProviderStore: () => true,
  isProviderParticipating: () => true,
}))
import { useLazyPlaylist } from './useLazyPlaylist'

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
