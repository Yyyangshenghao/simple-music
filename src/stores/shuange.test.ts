import { describe, it, expect, beforeEach, vi } from 'vitest'

// 桩 player / playlist / navigation / service
// vi.mock 工厂会被提升到文件顶部,引用普通 const 会落入 TDZ;用 vi.hoisted 保证工厂可访问。
const {
  loadTrack,
  pause,
  seek,
  setVolume,
  playlistSetQueue,
  playlistSetState,
  navigateTo,
  getLyrics,
  getDailySongs,
  getRadarPlaylist,
  getRecommendPlaylists,
  getPlaylistSkeleton,
  getListeningRanking,
  getLikedPlaylist,
  playerSubscriptions,
} = vi.hoisted(() => ({
  loadTrack: vi.fn().mockResolvedValue(undefined),
  pause: vi.fn(),
  seek: vi.fn(),
  setVolume: vi.fn(),
  playlistSetQueue: vi.fn(),
  playlistSetState: vi.fn(),
  navigateTo: vi.fn(),
  getLyrics: vi.fn(),
  getDailySongs: vi.fn(),
  getRadarPlaylist: vi.fn(),
  getRecommendPlaylists: vi.fn(),
  getPlaylistSkeleton: vi.fn(),
  getListeningRanking: vi.fn(),
  getLikedPlaylist: vi.fn(),
  playerSubscriptions: [] as Array<(state: { status: string; position: number }) => void>,
}))

// 可变 player 状态:测试可改写以触发 leave 恢复分支
let mockCurrentTrack: ReturnType<typeof mkTrack> | null = null
let mockPosition = 0
let mockVolume = 0.8
let mockStatus: 'playing' | 'paused' | 'loading' = 'playing'

vi.mock('../lib/service-registry', () => ({
  serviceFor: () => ({
    getLyrics,
    getDailySongs,
    getRadarPlaylist,
    getRecommendPlaylists,
    getPlaylistSkeleton,
    getListeningRanking,
    getLikedPlaylist,
  }),
}))

vi.mock('../lib/track-preload', () => ({ preloadTracks: vi.fn() }))

vi.mock('./player', () => ({
  usePlayerStore: {
    subscribe: (callback: (state: { status: string; position: number }) => void) => {
      playerSubscriptions.push(callback)
      return () => {}
    },
    getState: () => ({
      loadTrack,
      pause,
      seek,
      setVolume,
      currentTrack: mockCurrentTrack,
      position: mockPosition,
      volume: mockVolume,
      quality: 'standard',
      status: mockStatus,
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
  useSettingsStore: { getState: () => ({ activeSource: 'netease' }), subscribe: () => () => {} },
}))

import {
  __getShuangeRecommendationProfile,
  __resetShuangeRecommendationProfile,
  stashShuangeCandidates,
} from '../lib/shuange-recommendation'
import { useShuangeStore, __resetOffsetCache } from './shuange'
import type { Track } from '../types/domain'

function mkTrack(id: string, durMs = 180_000): Track {
  return { provider: 'netease', source: 'netease', type: 'song', id, name: `t-${id}`, artist: 'a', artists: [], duration: durMs }
}

function emitPlayer(status: typeof mockStatus, position: number): void {
  mockStatus = status
  mockPosition = position
  const state = { status, position }
  playerSubscriptions.forEach((callback) => callback(state))
}

describe('shuange store', () => {
  beforeEach(() => {
    mockCurrentTrack = null
    mockPosition = 0
    mockVolume = 0.8
    mockStatus = 'playing'
    loadTrack.mockClear()
    pause.mockClear()
    seek.mockClear()
    setVolume.mockClear()
    playlistSetState.mockClear()
    getLyrics.mockReset()
    getDailySongs.mockReset()
    getRadarPlaylist.mockReset()
    getRecommendPlaylists.mockReset()
    getPlaylistSkeleton.mockReset()
    getListeningRanking.mockReset()
    getLikedPlaylist.mockReset()
    __resetOffsetCache()
    __resetShuangeRecommendationProfile()
    useShuangeStore.setState({ active: false, feed: [], index: -1, direction: 1, offset: null, loading: false, error: null })
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
    expect(track).toBe(s.feed[0])
    expect(opts?.startAt).toBeGreaterThanOrEqual(0)
  })

  it('进入时优先避开上次刚曝光的歌曲', async () => {
    __resetShuangeRecommendationProfile({
      seenKeys: ['netease:1'],
      trackScores: {},
      artistScores: {},
    })
    getDailySongs.mockResolvedValue([mkTrack('1'), mkTrack('2')])
    getLyrics.mockResolvedValue([])

    await useShuangeStore.getState().enter()

    expect(useShuangeStore.getState().feed[0].id).toBe('2')
  })

  it('换一批优先消费本地候选池，不重新请求今日推荐也不会重复同一批', async () => {
    const cached = Array.from({ length: 24 }, (_, index) => mkTrack(`cache-${index}`))
    stashShuangeCandidates(cached)
    getRecommendPlaylists.mockResolvedValue([])
    getLyrics.mockResolvedValue([])

    await useShuangeStore.getState().enter()
    const firstBatch = new Set(useShuangeStore.getState().feed.map((track) => track.id))
    getDailySongs.mockClear()

    await useShuangeStore.getState().refresh()
    const secondBatch = useShuangeStore.getState().feed

    expect(secondBatch).toHaveLength(12)
    expect(secondBatch.every((track) => !firstBatch.has(track.id))).toBe(true)
    expect(getDailySongs).not.toHaveBeenCalled()
  })

  it('进入刷歌后在后台导入常听和收藏曲目画像，不阻塞首屏', async () => {
    getDailySongs.mockResolvedValue([mkTrack('daily')])
    getRecommendPlaylists.mockResolvedValue([])
    getListeningRanking.mockResolvedValue([mkTrack('ranking')])
    getLikedPlaylist.mockResolvedValue({ id: 'likes' })
    getPlaylistSkeleton.mockResolvedValue({ trackIds: [], tracks: [mkTrack('liked')] })
    getLyrics.mockResolvedValue([])

    await useShuangeStore.getState().enter()

    expect(loadTrack).toHaveBeenCalledOnce()
    await vi.waitFor(() => expect(__getShuangeRecommendationProfile().trackScores).toEqual({}))
    await vi.waitFor(() => expect(__getShuangeRecommendationProfile().artistScores['netease:a']).toBeGreaterThan(0))
  })

  it('首歌开始后后台混入私人雷达和随机推荐歌单，不阻塞首屏', async () => {
    getDailySongs.mockResolvedValue([mkTrack('daily')])
    getRadarPlaylist.mockResolvedValue({ playlist: { id: 'radar' }, tracks: [mkTrack('radar')] })
    getRecommendPlaylists.mockResolvedValue([{ id: 'p1' }, { id: 'p2' }])
    getPlaylistSkeleton.mockImplementation(async (id: string) => ({ trackIds: [], tracks: [mkTrack(`playlist-${id}`)] }))
    getLyrics.mockResolvedValue([])

    await useShuangeStore.getState().enter()

    expect(loadTrack).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(useShuangeStore.getState().feed.length).toBe(4))
    expect(new Set(useShuangeStore.getState().feed.map((item) => item.id))).toEqual(
      new Set(['daily', 'radar', 'playlist-p1', 'playlist-p2'])
    )
  })

  it('补曲失败且没有真正切歌时不记录快速划走反馈', async () => {
    getDailySongs.mockResolvedValue([mkTrack('only')])
    getRecommendPlaylists.mockResolvedValue([])
    getLyrics.mockResolvedValue([])
    await useShuangeStore.getState().enter()

    await useShuangeStore.getState().next()

    expect(useShuangeStore.getState().index).toBe(0)
    expect(__getShuangeRecommendationProfile().trackScores).toEqual({})
  })

  it('连续触底时复用同一个补曲请求，不并发翻多页', async () => {
    let resolveMore!: (value: never[]) => void
    getDailySongs.mockResolvedValue([mkTrack('only')])
    getRecommendPlaylists.mockImplementation((page: number) => (
      page === 0 ? Promise.resolve([]) : new Promise((resolve) => { resolveMore = resolve })
    ))
    getLyrics.mockResolvedValue([])
    await useShuangeStore.getState().enter()
    await vi.waitFor(() => expect(getRecommendPlaylists).toHaveBeenCalledWith(0))

    const first = useShuangeStore.getState().next()
    const second = useShuangeStore.getState().next()

    await vi.waitFor(() => expect(getRecommendPlaylists).toHaveBeenCalledWith(1))
    expect(getRecommendPlaylists.mock.calls.filter(([page]) => page === 1)).toHaveLength(1)
    resolveMore([])
    await Promise.all([first, second])
  })

  it('歌单页补货失败后保留分页游标，下一次后台补货会重试当前页', async () => {
    getDailySongs.mockResolvedValue([mkTrack('only')])
    getRecommendPlaylists
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValueOnce([])
    getLyrics.mockResolvedValue([])

    await useShuangeStore.getState().enter()
    await vi.waitFor(() => expect(getRecommendPlaylists).toHaveBeenCalledTimes(2))

    expect(getRecommendPlaylists.mock.calls.map(([page]) => page)).toEqual([0, 0])
  })

  it('仍在 loading、没有真正播放时退出不写收听反馈', async () => {
    mockStatus = 'loading'
    getDailySongs.mockResolvedValue([mkTrack('loading')])
    getLyrics.mockResolvedValue([])
    await useShuangeStore.getState().enter()

    useShuangeStore.getState().leave()

    expect(__getShuangeRecommendationProfile().trackScores).toEqual({})
  })

  it('真正进入 playing 后按实际片段进度记录快速划走', async () => {
    mockStatus = 'loading'
    getDailySongs.mockResolvedValue([mkTrack('first'), mkTrack('second')])
    getLyrics.mockResolvedValue([])
    await useShuangeStore.getState().enter()
    const state = useShuangeStore.getState()
    const current = state.feed[state.index]
    const startSec = state.offset?.startSec ?? 0

    emitPlayer('playing', startSec + 3)
    await useShuangeStore.getState().next()

    expect(__getShuangeRecommendationProfile().trackScores[`netease:${String(current.id)}`]).toBe(-1.5)
  })

  it('无歌词时回退到时长偏移仍能 loadTrack', async () => {
    getDailySongs.mockResolvedValue([mkTrack('9')])
    getLyrics.mockResolvedValue([])
    await useShuangeStore.getState().enter()
    expect(loadTrack).toHaveBeenCalledTimes(1)
    const opts = loadTrack.mock.calls[0][1]
    expect(opts?.startAt).toBeGreaterThanOrEqual(0)
  })

  it('歌词请求卡住时也会在短等待后开始播放，不阻塞切歌', async () => {
    getDailySongs.mockResolvedValue([mkTrack('slow')])
    getLyrics.mockReturnValue(new Promise(() => {}))

    await useShuangeStore.getState().enter()

    expect(loadTrack).toHaveBeenCalledTimes(1)
    expect(useShuangeStore.getState().loading).toBe(false)
  })

  it('超时后歌词结果晚到时会校正当前片段，不永久停在结构回退点', async () => {
    let resolveLyrics!: (value: Array<{ time: number; text: string }>) => void
    getDailySongs.mockResolvedValue([mkTrack('late')])
    getLyrics.mockReturnValue(new Promise((resolve) => { resolveLyrics = resolve }))

    await useShuangeStore.getState().enter()
    const fallback = useShuangeStore.getState().offset
    expect(fallback?.kind).toBe('structure')
    mockCurrentTrack = mkTrack('late')

    resolveLyrics([
      { time: 18, text: '这是第一段主歌内容' },
      { time: 25, text: '继续讲述不同故事' },
      { time: 52, text: '我们奔向同一片海' },
      { time: 58, text: '把所有夜晚都点亮' },
      { time: 96, text: '我们奔向同一片海' },
      { time: 102, text: '把所有夜晚都点亮' },
    ])
    await vi.waitFor(() => expect(useShuangeStore.getState().offset?.kind).toBe('refrain'))

    const refined = useShuangeStore.getState().offset
    expect(refined?.startSec).not.toBe(fallback?.startSec)
    expect(seek).toHaveBeenCalledWith(refined?.startSec)
  })

  it('推荐加载失败时不暂停原播放', async () => {
    getDailySongs.mockRejectedValue(new Error('network'))

    await useShuangeStore.getState().enter()

    expect(pause).not.toHaveBeenCalled()
    expect(useShuangeStore.getState().error).toBe('network')
  })

  it('预热相邻曲目的 offset，切到下一首时不再请求歌词', async () => {
    getDailySongs.mockResolvedValue([mkTrack('1'), mkTrack('2')])
    getLyrics.mockResolvedValue(Array.from({ length: 10 }, (_, i) => ({ time: 40 + i, text: 'y' })))
    await useShuangeStore.getState().enter() // 加载 track 1，并在后台预热 track 2
    await vi.waitFor(() => expect(getLyrics).toHaveBeenCalledTimes(2))
    getLyrics.mockClear()
    await useShuangeStore.getState().next()
    expect(getLyrics).not.toHaveBeenCalled()
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

  it('进入前没有曲目时退出也会暂停刷歌曲目', async () => {
    getDailySongs.mockResolvedValue([mkTrack('1')])
    getLyrics.mockResolvedValue([])
    await useShuangeStore.getState().enter()
    pause.mockClear()

    useShuangeStore.getState().leave()

    expect(pause).toHaveBeenCalledOnce()
  })

  it('退出后的旧恢复任务不会暂停新进入的刷歌会话', async () => {
    mockCurrentTrack = mkTrack('snapshot')
    getDailySongs.mockResolvedValue([mkTrack('1')])
    getLyrics.mockResolvedValue([])
    await useShuangeStore.getState().enter()

    let resolveRestore!: () => void
    loadTrack.mockImplementationOnce(() => new Promise<void>((resolve) => { resolveRestore = resolve }))
    useShuangeStore.getState().leave()

    await useShuangeStore.getState().enter()
    pause.mockClear()
    resolveRestore()
    await Promise.resolve()

    expect(pause).not.toHaveBeenCalled()
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
