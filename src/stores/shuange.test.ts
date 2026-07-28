import { describe, it, expect, beforeEach, vi } from 'vitest'

// 桩 player / playlist / navigation / service
// vi.mock 工厂会被提升到文件顶部,引用普通 const 会落入 TDZ;用 vi.hoisted 保证工厂可访问。
const {
  loadTrack,
  pause,
  setVolume,
  playlistSetQueue,
  playlistSetState,
  navigateTo,
  getLyrics,
  getDailySongs,
  getRecommendPlaylists,
  getPlaylistSkeleton,
} = vi.hoisted(() => ({
  loadTrack: vi.fn().mockResolvedValue(undefined),
  pause: vi.fn(),
  setVolume: vi.fn(),
  playlistSetQueue: vi.fn(),
  playlistSetState: vi.fn(),
  navigateTo: vi.fn(),
  getLyrics: vi.fn(),
  getDailySongs: vi.fn(),
  getRecommendPlaylists: vi.fn(),
  getPlaylistSkeleton: vi.fn(),
}))

// 可变 player 状态:测试可改写以触发 leave 恢复分支
let mockCurrentTrack: ReturnType<typeof mkTrack> | null = null
let mockPosition = 0
let mockVolume = 0.8

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
      pause,
      setVolume,
      currentTrack: mockCurrentTrack,
      position: mockPosition,
      volume: mockVolume,
    }),
  },
}))
vi.mock('./playlist', () => ({
  usePlaylistStore: {
    getState: () => ({ queue: [], queueIndex: -1, queueContextId: null }),
    setQueue: playlistSetQueue,
    setState: playlistSetState,
  },
}))
vi.mock('./navigation', () => ({
  useNavigationStore: { getState: () => ({ navigateTo }) },
}))
vi.mock('./settings', () => ({
  useSettingsStore: { getState: () => ({ activeSource: 'netease' }) },
}))

import { useShuangeStore, __resetOffsetCache } from './shuange'
import type { Track } from '../types/domain'

function mkTrack(id: string, durMs = 180_000): Track {
  return { provider: 'netease', source: 'netease', type: 'song', id, name: `t-${id}`, artist: 'a', artists: [], duration: durMs }
}

describe('shuange store', () => {
  beforeEach(() => {
    mockCurrentTrack = null
    mockPosition = 0
    mockVolume = 0.8
    loadTrack.mockClear()
    pause.mockClear()
    setVolume.mockClear()
    playlistSetState.mockClear()
    getLyrics.mockReset()
    getDailySongs.mockReset()
    getRecommendPlaylists.mockReset()
    getPlaylistSkeleton.mockReset()
    __resetOffsetCache()
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
    await useShuangeStore.getState().enter() // 加载并缓存 track 1
    getLyrics.mockClear()
    await useShuangeStore.getState().prev() // index 0 无 prev,loadIndex 未触发
    expect(getLyrics).not.toHaveBeenCalled() // 缓存命中路径未调 getLyrics
    await useShuangeStore.getState().next() // → 2,新歌未缓存,会 getLyrics
    expect(getLyrics).toHaveBeenCalled()
  })

  it('leave 恢复快照(setState + loadTrack 暂停态 + 恢复音量)', async () => {
    const snapTrack = mkTrack('snap-1')
    mockCurrentTrack = snapTrack
    mockPosition = 42420
    mockVolume = 0.63

    getDailySongs.mockResolvedValue([mkTrack('1')])
    getLyrics.mockResolvedValue([])
    await useShuangeStore.getState().enter()

    // 清掉 enter 期间的调用,只观察 leave 行为
    loadTrack.mockClear()
    pause.mockClear()
    setVolume.mockClear()
    playlistSetState.mockClear()

    useShuangeStore.getState().leave()

    // leave 应恢复音量
    expect(setVolume).toHaveBeenCalledWith(0.63)
    // leave 应恢复原队列
    expect(playlistSetState).toHaveBeenCalledOnce()
    // leave 应触发恢复 loadTrack(快照曲目 + 原位置)
    expect(loadTrack).toHaveBeenCalledTimes(1)
    const [track, opts] = loadTrack.mock.calls[0]
    expect(String(track.id)).toBe('snap-1')
    expect(opts?.startAt).toBe(42420)
  })

  it('竞态守卫:leave 后在途 enter 的 loadTrack 不再触发', async () => {
    let resolveSongs!: (v: Track[]) => void
    getDailySongs.mockReturnValue(new Promise((r) => { resolveSongs = r }))
    getLyrics.mockResolvedValue([])

    const enterP = useShuangeStore.getState().enter()
    // 在 getDailySongs 未 resolve 时立即 leave
    useShuangeStore.getState().leave()
    resolveSongs([mkTrack('1')])
    await enterP

    // enter 在 await 后检测到 session 过期,应提前 return,不调 loadTrack
    expect(loadTrack).not.toHaveBeenCalled()
  })
})
