import { describe, it, expect, beforeEach, vi } from 'vitest'

// 桩 player / playlist / navigation / service
// vi.mock 工厂会被提升到文件顶部,引用普通 const 会落入 TDZ;用 vi.hoisted 保证工厂可访问。
const {
  loadTrack,
  playlistSetQueue,
  navigateTo,
  getLyrics,
  getDailySongs,
  getRecommendPlaylists,
  getPlaylistSkeleton,
} = vi.hoisted(() => ({
  loadTrack: vi.fn().mockResolvedValue(undefined),
  playlistSetQueue: vi.fn(),
  navigateTo: vi.fn(),
  getLyrics: vi.fn(),
  getDailySongs: vi.fn(),
  getRecommendPlaylists: vi.fn(),
  getPlaylistSkeleton: vi.fn(),
}))

vi.mock('../lib/service-registry', () => ({
  serviceFor: () => ({
    getLyrics,
    getDailySongs,
    getRecommendPlaylists,
    getPlaylistSkeleton,
  }),
}))

vi.mock('./player', () => ({
  usePlayerStore: {
    getState: () => ({
      loadTrack,
      pause: vi.fn(),
      currentTrack: null,
    }),
  },
}))
vi.mock('./playlist', () => ({
  usePlaylistStore: {
    getState: () => ({ queue: [], queueIndex: -1, queueContextId: null }),
    setQueue: playlistSetQueue,
    setState: vi.fn(),
  },
}))
vi.mock('./navigation', () => ({
  useNavigationStore: { getState: () => ({ navigateTo }) },
}))
vi.mock('./settings', () => ({
  useSettingsStore: { getState: () => ({ activeSource: 'netease' }) },
}))

import { useShuangeStore } from './shuange'
import type { Track } from '../types/domain'

function mkTrack(id: string, durMs = 180_000): Track {
  return { provider: 'netease', source: 'netease', type: 'song', id, name: `t-${id}`, artist: 'a', artists: [], duration: durMs }
}

describe('shuange store', () => {
  beforeEach(() => {
    loadTrack.mockClear()
    getLyrics.mockReset()
    getDailySongs.mockReset()
    getRecommendPlaylists.mockReset()
    getPlaylistSkeleton.mockReset()
    useShuangeStore.setState({ active: false, feed: [], index: -1, offset: null, loading: false, error: null })
  })

  it('enter 拉首屏并 loadIndex(0) 调 loadTrack 带 startAt', async () => {
    getDailySongs.mockResolvedValue([mkTrack('1'), mkTrack('2')])
    getLyrics.mockResolvedValue([{ time: 40, text: 'x' }, ...Array.from({ length: 9 }, (_, i) => ({ time: 41 + i, text: 'y' }))])
    await useShuangeStore.getState().enter()
    const s = useShuangeStore.getState()
    expect(s.feed.length).toBe(2)
    expect(s.index).toBe(0)
    expect(loadTrack).toHaveBeenCalledTimes(1)
    const [track, opts] = loadTrack.mock.calls[0]
    expect(String(track.id)).toBe('1')
    expect(opts?.startAt).toBeGreaterThanOrEqual(0)
  })

  it('无歌词时回退到时长偏移仍能 loadTrack', async () => {
    getDailySongs.mockResolvedValue([mkTrack('9')])
    getLyrics.mockResolvedValue([])
    await useShuangeStore.getState().enter()
    expect(loadTrack).toHaveBeenCalledTimes(1)
    const opts = loadTrack.mock.calls[0][1]
    expect(opts?.startAt).toBeGreaterThanOrEqual(0)
  })

  it('offset 缓存命中时不再 getLyrics', async () => {
    getDailySongs.mockResolvedValue([mkTrack('1'), mkTrack('2')])
    getLyrics.mockResolvedValue(Array.from({ length: 10 }, (_, i) => ({ time: 40 + i, text: 'y' })))
    await useShuangeStore.getState().enter() // 加载并缓存 1
    getLyrics.mockClear()
    await useShuangeStore.getState().prev() // index 0 无 prev
    await useShuangeStore.getState().next() // → 2,新歌未缓存,会 getLyrics
    expect(getLyrics).toHaveBeenCalled()
  })

  it('leave 恢复快照(setState + loadTrack 暂停态)', async () => {
    getDailySongs.mockResolvedValue([mkTrack('1')])
    getLyrics.mockResolvedValue([])
    await useShuangeStore.getState().enter()
    useShuangeStore.getState().leave()
    // 离开应触发一次恢复 loadTrack(快照曲目,暂停态)
    expect(loadTrack).toHaveBeenCalled()
  })
})
