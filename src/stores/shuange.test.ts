import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// 桩 player / playlist / navigation / service
// vi.mock 工厂会被提升到文件顶部,引用普通 const 会落入 TDZ;用 vi.hoisted 保证工厂可访问。
const {
  loadTrack,
  pause,
  seek,
  setVolume,
  playlistSetQueue,
  playlistSetState,
  getLyrics,
  getDailySongs,
  getRadioSongs,
  getRecentTracks,
  getRadarPlaylist,
  getRecommendPlaylists,
  getPlaylistSkeleton,
  getListeningRanking,
  getLikedPlaylist,
  playerSubscriptions,
  preloadTracks,
  waitForShuangeAudio,
  prepareShuangeAudio,
} = vi.hoisted(() => ({
  loadTrack: vi.fn().mockResolvedValue(undefined),
  pause: vi.fn(),
  seek: vi.fn(),
  setVolume: vi.fn(),
  playlistSetQueue: vi.fn(),
  playlistSetState: vi.fn(),
  getLyrics: vi.fn(),
  getDailySongs: vi.fn(),
  getRadioSongs: vi.fn(),
  getRecentTracks: vi.fn(),
  getRadarPlaylist: vi.fn(),
  getRecommendPlaylists: vi.fn(),
  getPlaylistSkeleton: vi.fn(),
  getListeningRanking: vi.fn(),
  getLikedPlaylist: vi.fn(),
  playerSubscriptions: [] as Array<(state: { status: string; position: number; quality: AudioQuality; currentTrack?: Track }) => void>,
  preloadTracks: vi.fn(),
  waitForShuangeAudio: vi.fn(),
  prepareShuangeAudio: vi.fn(),
}))

// 可变 player 状态:测试可改写以触发 leave 恢复分支
let mockCurrentTrack: ReturnType<typeof mkTrack> | null = null
let mockPosition = 0
let mockVolume = 0.8
let mockStatus: 'playing' | 'paused' | 'loading' = 'playing'
let mockQuality: AudioQuality = 'standard'

vi.mock('../lib/service-registry', () => ({
  serviceFor: (source: string) => ({
    getLyrics,
    getDailySongs,
    getRadioSongs: source === 'qq' ? getRadioSongs : undefined,
    getRecentTracks: source === 'qq' ? getRecentTracks : undefined,
    getRadarPlaylist,
    getRecommendPlaylists,
    getPlaylistSkeleton,
    getListeningRanking: source === 'qq' ? undefined : getListeningRanking,
    getLikedPlaylist,
  }),
}))

vi.mock('../lib/track-preload', () => ({
  preloadTracks, preloadTrackUrl: vi.fn(async () => {}),
  releasePreloadWindow: vi.fn(), getPreloadedResolution: () => undefined,
}))
vi.mock('../lib/shuange-audio-preload', () => ({
  waitForShuangeAudio, prepareShuangeAudio, releaseShuangeAudio: vi.fn(),
}))

vi.mock('./player', () => ({
  usePlayerStore: {
    subscribe: (callback: (state: { status: string; position: number; quality: AudioQuality; currentTrack?: Track }) => void) => {
      playerSubscriptions.push(callback)
      return () => {
        const index = playerSubscriptions.indexOf(callback)
        if (index >= 0) playerSubscriptions.splice(index, 1)
      }
    },
    getState: () => ({
      loadTrack,
      pause,
      seek,
      setVolume,
      currentTrack: mockCurrentTrack,
      position: mockPosition,
      volume: mockVolume,
      quality: mockQuality,
      status: mockStatus,
      contextId: 'shuange:test',
      _engine: () => ({}),
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
vi.mock('./settings', () => ({
  SETTINGS_STORAGE_KEY: 'simplemusic-settings-test',
  useSettingsStore: { getState: () => ({}), subscribe: () => () => {} },
}))

import {
  __getShuangeRecommendationProfile,
  __resetShuangeRecommendationProfile,
  stashShuangeCandidates,
  takeShuangeCandidateBatch,
} from '../lib/shuange-recommendation'
import { useShuangeStore, __resetOffsetCache, initShuangeSession } from './shuange'
import { getShuangeFeedContext } from '../lib/shuange-feed'
import { clearProviderRequestCache, requestProviderData } from '../lib/provider-request-cache'
import { useProviderStore } from './providers'
import { useNavigationStore } from './navigation'
import type { AudioQuality, Track } from '../types/domain'
import { beginPlaybackIntent } from '../lib/playback-intent'

function mkTrack(id: string, durMs = 180_000): Track {
  return { provider: 'netease', source: 'netease', type: 'song', id, name: `t-${id}`, artist: 'a', artists: [], duration: durMs }
}

function emitPlayer(status: typeof mockStatus, position: number): void {
  mockStatus = status
  mockPosition = position
  const state = { status, position, quality: mockQuality, currentTrack: useShuangeStore.getState().feed[useShuangeStore.getState().index] }
  playerSubscriptions.forEach((callback) => callback(state))
}

describe('shuange store', () => {
  let stopSession: (() => void) | undefined
  afterEach(() => { stopSession?.(); stopSession = undefined })
  beforeEach(() => {
    if (useShuangeStore.getState().active) useShuangeStore.getState().leave()
    useShuangeStore.setState({ active: false, feed: [], index: -1, historyEnd: -1, direction: 1, offset: null, loading: false, stage: null, error: null })
    mockCurrentTrack = null
    mockPosition = 0
    mockVolume = 0.8
    mockStatus = 'playing'
    mockQuality = 'standard'
    loadTrack.mockReset().mockResolvedValue(undefined)
    pause.mockClear()
    seek.mockClear()
    setVolume.mockClear()
    playlistSetState.mockClear()
    getLyrics.mockReset()
    getDailySongs.mockReset()
    getRadioSongs.mockReset()
    getRecentTracks.mockReset()
    getRadarPlaylist.mockReset()
    getRecommendPlaylists.mockReset()
    getPlaylistSkeleton.mockReset()
    getListeningRanking.mockReset()
    getLikedPlaylist.mockReset()
    preloadTracks.mockClear()
    waitForShuangeAudio.mockReset()
    prepareShuangeAudio.mockClear()
    clearProviderRequestCache()
    __resetOffsetCache()
    __resetShuangeRecommendationProfile()
    useProviderStore.setState({
      byId: {
        netease: { enabled: true, auth: 'authenticated' },
        qq: { enabled: true, auth: 'authenticated' },
        apple: { enabled: false, auth: 'anonymous' },
      },
      playbackOrder: ['netease', 'qq'],
    })
    // 普通用例自行安排候选响应 登录预热另有专项覆盖
    const warmup = vi.spyOn(useShuangeStore.getState(), 'warmup').mockResolvedValueOnce()
    stopSession = initShuangeSession()
    warmup.mockRestore()
  })

  afterEach(() => {
    __resetOffsetCache()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('登录预热两批但不接管播放 进入和换批复用已准备顺序', async () => {
    stashShuangeCandidates(Array.from({ length: 36 }, (_, i) => mkTrack(`warm-${i}`)))
    getLyrics.mockResolvedValue([])
    await useShuangeStore.getState().warmup()
    await vi.waitFor(() => expect(getShuangeFeedContext()?.standby).toHaveLength(12))
    const target = getShuangeFeedContext()!
    const first = [...target.current]
    const second = [...target.standby]
    expect(useShuangeStore.getState().active).toBe(false)
    expect(loadTrack).not.toHaveBeenCalled()
    expect(pause).not.toHaveBeenCalled()
    expect(__getShuangeRecommendationProfile().seenKeys).toEqual([])

    await useShuangeStore.getState().enter()
    expect(useShuangeStore.getState().feed).toEqual(first)
    expect(__getShuangeRecommendationProfile().seenKeys).toEqual([`netease:${String(first[0].id)}`])
    await useShuangeStore.getState().notInterestedCurrent()
    expect(target.standby).toEqual(second)
    expect(__getShuangeRecommendationProfile().trackScores[`netease:${String(first[0].id)}`]).toBe(-5)
    await useShuangeStore.getState().refresh()
    expect(useShuangeStore.getState().feed).toEqual(second)
    expect(useShuangeStore.getState().historyEnd).toBe(0)
    expect(getDailySongs).not.toHaveBeenCalled()
  })

  it('每日推荐满足一批时不等待卡住的雷达即可起播', async () => {
    getDailySongs.mockResolvedValue(Array.from({ length: 12 }, (_, i) => mkTrack(`daily-${i}`)))
    getRadarPlaylist.mockReturnValue(new Promise(() => {}))
    getRecommendPlaylists.mockResolvedValue([])
    getLyrics.mockResolvedValue([])
    await useShuangeStore.getState().enter()
    expect(loadTrack).toHaveBeenCalledOnce()
    expect(useShuangeStore.getState().feed).toHaveLength(12)
  })

  it('歌单列表返回后立即查曲目而不等待雷达', async () => {
    getDailySongs.mockResolvedValue([])
    getRadarPlaylist.mockReturnValue(new Promise(() => {}))
    getRecommendPlaylists.mockResolvedValue([{ id: 'ready' }])
    getPlaylistSkeleton.mockResolvedValue({ tracks: Array.from({ length: 24 }, (_, i) => mkTrack(`playlist-${i}`)) })
    getLyrics.mockResolvedValue([])
    await useShuangeStore.getState().enter()
    expect(getPlaylistSkeleton).toHaveBeenCalledWith('ready')
    expect(loadTrack).toHaveBeenCalledOnce()
  })

  it('刷歌复用首页每日推荐响应而不重复请求', async () => {
    const tracks = Array.from({ length: 12 }, (_, i) => mkTrack(`home-${i}`))
    await requestProviderData('netease', 'recommendation:netease:daily-songs:root', async () => ({
      content: { type: 'tracks', tracks }, hasMore: false,
    }))
    getLyrics.mockResolvedValue([])
    await useShuangeStore.getState().enter()
    expect(getDailySongs).not.toHaveBeenCalled()
    expect(useShuangeStore.getState().feed).toHaveLength(12)
  })

  it('网易云固定日推耗尽后补货不重复查询日推', async () => {
    getDailySongs.mockResolvedValue(Array.from({ length: 24 }, (_, i) => mkTrack(`daily-${i}`)))
    getRecommendPlaylists.mockResolvedValue([])
    getRadarPlaylist.mockResolvedValue(null)
    getLyrics.mockResolvedValue([])
    await useShuangeStore.getState().enter()
    await useShuangeStore.getState().refresh()
    await useShuangeStore.getState().refresh()

    expect(useShuangeStore.getState().error).toBe('暂时没有新的推荐内容,稍后再来')
    expect(getDailySongs).toHaveBeenCalledOnce()
    expect(getRadioSongs).not.toHaveBeenCalled()
  })

  it('自然跨批保留至多100首历史 回退复用顺序 手动换批重置', async () => {
    stashShuangeCandidates(Array.from({ length: 180 }, (_, i) => mkTrack(`history-${i}`)))
    getLyrics.mockResolvedValue([])
    await useShuangeStore.getState().enter()
    for (let i = 0; i < 105; i++) await useShuangeStore.getState().next()
    const before = useShuangeStore.getState()
    expect(before.index).toBe(99)
    expect(before.historyEnd).toBe(99)
    expect(before.feed.length).toBeLessThanOrEqual(111)
    const current = before.feed[before.index]
    await useShuangeStore.getState().prev()
    await useShuangeStore.getState().next()
    expect(useShuangeStore.getState().feed[useShuangeStore.getState().index]).toBe(current)
    expect(getDailySongs).not.toHaveBeenCalled()
    await useShuangeStore.getState().refresh()
    expect(useShuangeStore.getState().feed).toHaveLength(12)
    expect(useShuangeStore.getState().index).toBe(0)
    expect(useShuangeStore.getState().historyEnd).toBe(0)
  })

  it('100ms内连续切歌只按最终位置补齐前后两首和备用首曲', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    stashShuangeCandidates(Array.from({ length: 36 }, (_, i) => mkTrack(`window-${i}`)))
    getLyrics.mockResolvedValue([])
    await useShuangeStore.getState().enter()
    await vi.advanceTimersByTimeAsync(100)
    preloadTracks.mockClear()
    await useShuangeStore.getState().next()
    await useShuangeStore.getState().next()
    expect(preloadTracks).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(100)
    expect(preloadTracks).toHaveBeenCalledOnce()
    const state = useShuangeStore.getState()
    const keys = preloadTracks.mock.calls[0][0].map((track: Track) => track.id)
    expect(new Set(keys)).toEqual(new Set([
      ...state.feed.slice(0, 5).map(track => track.id), getShuangeFeedContext()!.standby[0].id,
    ]))
    preloadTracks.mockClear()
    await useShuangeStore.getState().prev()
    await vi.advanceTimersByTimeAsync(100)
    const backKeys = preloadTracks.mock.calls[0][0].map((track: Track) => track.id)
    expect(new Set(backKeys)).toEqual(new Set([
      ...state.feed.slice(0, 4).map(track => track.id), getShuangeFeedContext()!.standby[0].id,
    ]))
  })

  it('音频按移动方向准备前后各两首 批尾包含备用批且首曲不虚构历史', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('Audio', vi.fn())
    stashShuangeCandidates(Array.from({ length: 36 }, (_, i) => mkTrack(`audio-window-${i}`)))
    getLyrics.mockResolvedValue([])
    await useShuangeStore.getState().enter()
    await vi.advanceTimersByTimeAsync(100)
    const feed = useShuangeStore.getState().feed
    /** 读取宿主最新提交的音频目标 */
    const targets = () => prepareShuangeAudio.mock.lastCall![1].map((item: { track: Track }) => item.track)
    expect(targets()).toEqual([feed[1], feed[2]])
    await useShuangeStore.getState().loadIndex(3)
    await vi.advanceTimersByTimeAsync(100)
    expect(targets()).toEqual([feed[4], feed[2], feed[5], feed[1]])
    await useShuangeStore.getState().prev()
    await vi.advanceTimersByTimeAsync(100)
    expect(targets()).toEqual([feed[1], feed[3], feed[0], feed[4]])
    await useShuangeStore.getState().loadIndex(11)
    await vi.advanceTimersByTimeAsync(100)
    const standby = getShuangeFeedContext()!.standby
    expect(targets()).toEqual([standby[0], feed[10], standby[1], feed[9]])
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

  it('全部在线平台停用时不再请求任何在线平台', async () => {
    useProviderStore.setState({
      byId: {
        netease: { enabled: false, auth: 'anonymous' },
        qq: { enabled: false, auth: 'anonymous' },
        apple: { enabled: false, auth: 'anonymous' },
      },
      playbackOrder: [],
    })

    await useShuangeStore.getState().enter()

    expect(getDailySongs).not.toHaveBeenCalled()
    expect(useShuangeStore.getState().error).toBe('请先启用至少一个音乐平台')
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

  it('换一批立即消费备用批 新队尾补货不阻塞播放且不会重复同一批', async () => {
    const cached = Array.from({ length: 24 }, (_, index) => mkTrack(`cache-${index}`))
    stashShuangeCandidates(cached)
    getRecommendPlaylists.mockResolvedValue([])
    getLyrics.mockResolvedValue([])

    await useShuangeStore.getState().enter()
    const firstBatch = new Set(useShuangeStore.getState().feed.map((track) => track.id))
    expect(getDailySongs).not.toHaveBeenCalled()
    getDailySongs.mockReturnValue(new Promise(() => {}))

    await useShuangeStore.getState().refresh()
    const secondBatch = useShuangeStore.getState().feed

    expect(secondBatch).toHaveLength(12)
    expect(secondBatch.every((track) => !firstBatch.has(track.id))).toBe(true)
    expect(loadTrack).toHaveBeenCalledTimes(2)
    expect(getDailySongs).toHaveBeenCalledOnce()
  })

  it('切歌加载异常会结束等待并保留可重试状态', async () => {
    stashShuangeCandidates(Array.from({ length: 36 }, (_, i) => mkTrack(`failure-${i}`)))
    getLyrics.mockResolvedValue([])
    loadTrack.mockRejectedValueOnce(new Error('播放地址失败'))
    await useShuangeStore.getState().enter()
    expect(useShuangeStore.getState()).toMatchObject({ active: true, loading: false, stage: null, error: '播放地址失败' })
    await useShuangeStore.getState().next()
    expect(useShuangeStore.getState()).toMatchObject({ index: 1, loading: false, error: null })
  })

  it('旧切歌迟到的失败不覆盖新曲状态', async () => {
    stashShuangeCandidates(Array.from({ length: 36 }, (_, i) => mkTrack(`late-failure-${i}`)))
    getLyrics.mockResolvedValue([])
    let rejectOld!: (error: Error) => void
    loadTrack.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectOld = reject }))
    const entering = useShuangeStore.getState().enter()
    await vi.waitFor(() => expect(loadTrack).toHaveBeenCalledOnce())
    await useShuangeStore.getState().next()
    rejectOld(new Error('旧请求失败'))
    await entering
    expect(useShuangeStore.getState()).toMatchObject({ index: 1, loading: false, error: null })
  })

  it('宿主画像会话不重复接管导航 退出交由播放运行时', async () => {
    stashShuangeCandidates(Array.from({ length: 36 }, (_, i) => mkTrack(`route-${i}`)))
    getLyrics.mockResolvedValue([])
    useNavigationStore.setState({ currentView: 'shuange', history: [], future: [] })
    const dispose = initShuangeSession()
    try {
      await useShuangeStore.getState().enter()
      const feed = useShuangeStore.getState().feed
      useNavigationStore.setState({ navigationRevision: 1 })
      expect(useShuangeStore.getState().feed).toBe(feed)
      expect(useShuangeStore.getState().active).toBe(true)
      useNavigationStore.getState().navigateTo('explore')
      expect(useShuangeStore.getState().active).toBe(true)
    } finally { dispose() }
  })

  it('账号切换丢弃旧请求和候选 新会话单独预热', async () => {
    let finishOld!: (tracks: Track[]) => void
    getDailySongs.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve }))
      .mockResolvedValueOnce(Array.from({ length: 24 }, (_, i) => mkTrack(`new-account-${i}`)))
    getRecommendPlaylists.mockResolvedValue([])
    getLyrics.mockResolvedValue([])
    const dispose = initShuangeSession()
    try {
      void useShuangeStore.getState().warmup()
      const old = getShuangeFeedContext()
      useProviderStore.getState().setAccountState('netease', 'authenticated')
      await vi.waitFor(() => expect(getShuangeFeedContext()?.standby).toHaveLength(12))
      finishOld(Array.from({ length: 24 }, (_, i) => mkTrack(`old-account-${i}`)))
      await Promise.resolve()
      const target = getShuangeFeedContext()!
      expect(target).not.toBe(old)
      expect([...target.current, ...target.standby].every(track => String(track.id).startsWith('new-account-'))).toBe(true)
      expect(loadTrack).not.toHaveBeenCalled()
      await useShuangeStore.getState().enter()
      expect(String(loadTrack.mock.calls[0][0].id)).toMatch(/^new-account-/)
    } finally { dispose() }
  })

  it('自然批尾并发下一首只晋升一次且跨批窗口包含备用批前两首', async () => {
    vi.useFakeTimers()
    stashShuangeCandidates(Array.from({ length: 48 }, (_, i) => mkTrack(`boundary-${i}`)))
    getLyrics.mockResolvedValue([])
    await useShuangeStore.getState().enter()
    for (let i = 0; i < 11; i++) await useShuangeStore.getState().next()
    await vi.advanceTimersByTimeAsync(100)
    const standby = [...getShuangeFeedContext()!.standby]
    const lastTracks = preloadTracks.mock.lastCall![0] as Track[]
    expect(lastTracks).toContain(standby[0])
    expect(lastTracks).toContain(standby[1])
    const loadCount = loadTrack.mock.calls.length
    await Promise.all([useShuangeStore.getState().next(), useShuangeStore.getState().next()])
    expect(useShuangeStore.getState().index).toBe(12)
    expect(useShuangeStore.getState().feed.slice(12)).toEqual(standby)
    expect(loadTrack).toHaveBeenCalledTimes(loadCount + 1)
  })

  it('音质改变后按新档位补齐同一窗口而不重新生成批次', async () => {
    vi.useFakeTimers()
    stashShuangeCandidates(Array.from({ length: 36 }, (_, i) => mkTrack(`quality-${i}`)))
    getLyrics.mockResolvedValue([])
    const dispose = initShuangeSession()
    try {
      await useShuangeStore.getState().warmup()
      await vi.advanceTimersByTimeAsync(100)
      const first = getShuangeFeedContext()!.current
      mockQuality = 'lossless'
      emitPlayer('paused', 0)
      await vi.advanceTimersByTimeAsync(100)
      expect(preloadTracks.mock.lastCall?.[1]).toBe('lossless')
      expect(getShuangeFeedContext()!.current).toBe(first)
      expect(getDailySongs).not.toHaveBeenCalled()
      expect(loadTrack).not.toHaveBeenCalled()
    } finally { dispose() }
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

  it('QQ保持连续流补货，账号最近歌曲提供口味种子而非周排行', async () => {
    getRadioSongs.mockResolvedValue(Array.from({ length: 24 }, (_, i) => ({ ...mkTrack(`radio${i}`), source: 'qq', provider: 'qq' })))
    getRecentTracks.mockResolvedValue([{ ...mkTrack('recent'), source: 'qq', provider: 'qq' }])
    getRecommendPlaylists.mockResolvedValue([])
    getLyrics.mockResolvedValue([])
    useProviderStore.setState(state => ({ byId: { ...state.byId, netease: { enabled: false, auth: 'anonymous' } }, playbackOrder: ['qq'] }))
    await useShuangeStore.getState().enter()
    expect(getRadioSongs).toHaveBeenCalledTimes(1)
    expect(getDailySongs).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(getRecentTracks).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(__getShuangeRecommendationProfile().artistScores['qq:a']).toBeGreaterThan(0))
    expect(getListeningRanking).not.toHaveBeenCalled()
  })

  it.each(['自然切歌', '手动换批'])('QQ首页电台缓存耗尽后%s仍能取得后续曲目', async (action) => {
    const cached: Track[] = Array.from({ length: 20 }, (_, i) => ({ ...mkTrack(`home-radio-${i}`), source: 'qq', provider: 'qq' }))
    await requestProviderData('qq', 'recommendation:qq:radio:root', async () => ({
      content: { type: 'tracks', tracks: cached }, hasMore: true,
    }))
    getRadioSongs.mockResolvedValue(Array.from({ length: 24 }, (_, i) => ({ ...mkTrack(`next-radio-${i}`), source: 'qq', provider: 'qq' })))
    getRecommendPlaylists.mockResolvedValue([])
    getRadarPlaylist.mockResolvedValue(null)
    getLyrics.mockResolvedValue([])
    useProviderStore.setState({ playbackOrder: ['qq'] })
    await useShuangeStore.getState().enter()
    await vi.waitFor(() => expect(getShuangeFeedContext()?.standby).toHaveLength(8))
    expect(getRadioSongs).not.toHaveBeenCalled()

    if (action === '自然切歌') {
      for (let i = 0; i < 24; i++) await useShuangeStore.getState().next()
    } else {
      await useShuangeStore.getState().refresh()
      await useShuangeStore.getState().refresh()
    }

    const state = useShuangeStore.getState()
    expect(state.error).toBeNull()
    expect(String(state.feed[state.index].id)).toMatch(/^next-radio-/)
    expect(new Set(state.feed.map(track => track.id)).size).toBe(state.feed.length)
    expect(getRadioSongs).toHaveBeenCalledOnce()
    expect(getDailySongs).not.toHaveBeenCalled()
  })

  it('QQ歌单页持续失败时电台补货不依赖歌单游标', async () => {
    getRadioSongs
      .mockResolvedValueOnce(Array.from({ length: 24 }, (_, i) => ({ ...mkTrack(`first-radio-${i}`), source: 'qq', provider: 'qq' })))
      .mockResolvedValue(Array.from({ length: 24 }, (_, i) => ({ ...mkTrack(`second-radio-${i}`), source: 'qq', provider: 'qq' })))
    getRecommendPlaylists.mockRejectedValue(new Error('歌单暂时不可用'))
    getRadarPlaylist.mockResolvedValue(null)
    getLyrics.mockResolvedValue([])
    useProviderStore.setState({ playbackOrder: ['qq'] })
    await useShuangeStore.getState().enter()
    await vi.waitFor(() => expect(getShuangeFeedContext()?.refill).toBeNull())

    await useShuangeStore.getState().refresh()
    await useShuangeStore.getState().refresh()

    const state = useShuangeStore.getState()
    expect(state.error).toBeNull()
    expect(String(state.feed[state.index].id)).toMatch(/^second-radio-/)
    expect(getRadioSongs).toHaveBeenCalledTimes(2)
    expect(getRecommendPlaylists.mock.calls.map(([page]) => page)).toEqual([0, 0])
  })

  it.each(['空结果', '请求失败'])('QQ电台首次%s后允许重新补货', async (result) => {
    getRadioSongs.mockResolvedValue(Array.from({ length: 24 }, (_, i) => ({ ...mkTrack(`retry-radio-${i}`), source: 'qq', provider: 'qq' })))
    if (result === '空结果') getRadioSongs.mockResolvedValueOnce([])
    else getRadioSongs.mockRejectedValueOnce(new Error('电台暂时不可用'))
    getRecommendPlaylists.mockResolvedValue([])
    getRadarPlaylist.mockResolvedValue(null)
    getLyrics.mockResolvedValue([])
    useProviderStore.setState({ playbackOrder: ['qq'] })
    await useShuangeStore.getState().enter()
    expect(useShuangeStore.getState().feed).toEqual([])
    expect(useShuangeStore.getState().loading).toBe(false)

    await useShuangeStore.getState().enter()

    expect(useShuangeStore.getState().error).toBeNull()
    expect(useShuangeStore.getState().feed).toHaveLength(12)
    expect(getRadioSongs).toHaveBeenCalledTimes(2)
  })

  it('QQ电台后台补货期间连续换批复用在途请求', async () => {
    let finishRadio!: (tracks: Track[]) => void
    getRadioSongs
      .mockResolvedValueOnce(Array.from({ length: 24 }, (_, i) => ({ ...mkTrack(`first-radio-${i}`), source: 'qq', provider: 'qq' })))
      .mockImplementationOnce(() => new Promise<Track[]>(resolve => { finishRadio = resolve }))
    getRecommendPlaylists.mockResolvedValue([])
    getRadarPlaylist.mockResolvedValue(null)
    getLyrics.mockResolvedValue([])
    useProviderStore.setState({ playbackOrder: ['qq'] })
    await useShuangeStore.getState().enter()
    await vi.waitFor(() => expect(getShuangeFeedContext()?.standby).toHaveLength(12))
    await useShuangeStore.getState().refresh()

    const first = useShuangeStore.getState().refresh()
    const second = useShuangeStore.getState().refresh()
    expect(getRadioSongs).toHaveBeenCalledTimes(2)
    finishRadio(Array.from({ length: 24 }, (_, i) => ({ ...mkTrack(`next-radio-${i}`), source: 'qq', provider: 'qq' })))
    await Promise.all([first, second])

    const state = useShuangeStore.getState()
    expect(state.error).toBeNull()
    expect(state.feed).toHaveLength(12)
    expect(String(state.feed[0].id)).toMatch(/^next-radio-/)
    await vi.waitFor(() => expect(getShuangeFeedContext()?.standby).toHaveLength(12))
    expect(getRadioSongs).toHaveBeenCalledTimes(2)
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

  it('leave 恢复快照并延续进入前的播放状态', async () => {
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
    expect(opts?.autoplay).toBe(true)
    // 一次用于停止刷歌曲目；恢复完成后不会再次暂停原曲。
    expect(pause).toHaveBeenCalledTimes(1)
  })

  it('进入前已暂停时退出仍保持暂停', async () => {
    mockCurrentTrack = mkTrack('paused-snapshot')
    mockStatus = 'paused'
    getDailySongs.mockResolvedValue([mkTrack('1')])
    getLyrics.mockResolvedValue([])
    await useShuangeStore.getState().enter()
    loadTrack.mockClear()
    pause.mockClear()

    useShuangeStore.getState().leave()
    await Promise.resolve()

    expect(loadTrack.mock.calls[0][1]?.autoplay).toBe(false)
    expect(pause).toHaveBeenCalledTimes(2)
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

  it('宿主停止不恢复原音频，迟到推荐不写feed或候选池，反馈订阅也被解除', async () => {
    let resolveSongs!: (value: Track[]) => void
    getDailySongs.mockReturnValue(new Promise(resolve => { resolveSongs = resolve }))
    getRecommendPlaylists.mockResolvedValue([])
    mockCurrentTrack = mkTrack('original')
    const task = useShuangeStore.getState().enter()
    expect(initShuangeSession()).toBe(stopSession)
    expect(playerSubscriptions).toHaveLength(2)
    stopSession!()
    stopSession!()
    resolveSongs([mkTrack('late')])
    await task
    expect(loadTrack).not.toHaveBeenCalled()
    expect(playlistSetState).not.toHaveBeenCalled()
    expect(playerSubscriptions).toHaveLength(0)
    expect(useShuangeStore.getState()).toMatchObject({ active: false, loading: false, feed: [] })
    expect(takeShuangeCandidateBatch('netease', 12)).toEqual([])
  })

  it('等相邻音频时保留旧卡和声音 就绪后才切换并曝光', async () => {
    const songs = ['a', 'b', 'c'].map(id => mkTrack(id))
    getLyrics.mockResolvedValue([])
    useShuangeStore.setState({ active: true, feed: songs, index: 0, historyEnd: 0,
      offset: { startSec: 30, endSec: 60, kind: 'refrain' } })
    mockCurrentTrack = songs[0]
    mockPosition = 40
    let ready!: () => void
    waitForShuangeAudio.mockReturnValueOnce(new Promise<void>(resolve => { ready = resolve }))
    const next = useShuangeStore.getState().next()
    expect(useShuangeStore.getState()).toMatchObject({ index: 0, loading: true })
    expect(pause).not.toHaveBeenCalled()
    expect(loadTrack).not.toHaveBeenCalled()
    expect(waitForShuangeAudio).toHaveBeenLastCalledWith(expect.objectContaining({ track: songs[1] }), 'standard', 800)
    ready()
    await next
    expect(pause).toHaveBeenCalledOnce()
    expect(loadTrack).toHaveBeenCalledWith(songs[1], expect.objectContaining({ contextId: 'shuange:b', autoplay: true }))
    expect(useShuangeStore.getState()).toMatchObject({ index: 1, loading: false })
  })

  it.each(['pause', 'stop', 'prev'] as const)('等待音频期间 %s 取消切换 迟到准备不能重新出声', async action => {
    const songs = ['a', 'b'].map(id => mkTrack(id))
    useShuangeStore.setState({ active: true, feed: songs, index: 0, historyEnd: 0,
      offset: { startSec: 30, endSec: 60, kind: 'refrain' } })
    mockCurrentTrack = songs[0]
    mockPosition = 40
    let ready!: () => void
    waitForShuangeAudio.mockReturnValueOnce(new Promise<void>(resolve => { ready = resolve }))
    const next = useShuangeStore.getState().next()
    if (action === 'prev') await useShuangeStore.getState().prev()
    else beginPlaybackIntent(action === 'pause' ? 'pause' : undefined)
    ready()
    await next
    expect(loadTrack).not.toHaveBeenCalled()
    expect(useShuangeStore.getState()).toMatchObject({ index: 0, loading: false })
  })

  it('连续下一首以待切游标推进 最后目标就绪后旧准备不能覆盖', async () => {
    const songs = ['a', 'b', 'c'].map(id => mkTrack(id))
    getLyrics.mockResolvedValue([])
    useShuangeStore.setState({ active: true, feed: songs, index: 0, historyEnd: 0,
      offset: { startSec: 30, endSec: 60, kind: 'refrain' } })
    mockCurrentTrack = songs[0]
    mockPosition = 40
    let ready!: () => void
    waitForShuangeAudio.mockReturnValueOnce(new Promise<void>(resolve => { ready = resolve }))
    const first = useShuangeStore.getState().next()
    await useShuangeStore.getState().next()
    ready()
    await first
    expect(loadTrack).toHaveBeenCalledOnce()
    expect(loadTrack).toHaveBeenCalledWith(songs[2], expect.anything())
    expect(useShuangeStore.getState().index).toBe(2)
  })

  it('片段快结束时缩短等待预算 保留现有 250 ms 淡出余量', async () => {
    const songs = ['a', 'b'].map(id => mkTrack(id))
    getLyrics.mockResolvedValue([])
    useShuangeStore.setState({ active: true, feed: songs, index: 0, historyEnd: 0,
      offset: { startSec: 30, endSec: 60, kind: 'refrain' } })
    mockPosition = 59.5
    await useShuangeStore.getState().next()
    expect(waitForShuangeAudio).toHaveBeenLastCalledWith(expect.anything(), 'standard', 250)
  })

  it('停止等待首曲加载后，迟到完成不再发起画像或补货任务', async () => {
    getDailySongs.mockResolvedValue([mkTrack('first')])
    getRecommendPlaylists.mockResolvedValue([])
    getLyrics.mockResolvedValue([])
    let resolveLoad!: () => void
    loadTrack.mockReturnValueOnce(new Promise<void>(resolve => { resolveLoad = resolve }))
    const task = useShuangeStore.getState().enter()
    for (let i = 0; i < 40; i++) await Promise.resolve()
    expect(loadTrack).toHaveBeenCalledOnce()
    const rankings = getListeningRanking.mock.calls.length
    const likes = getLikedPlaylist.mock.calls.length
    stopSession!()
    const refills = getRecommendPlaylists.mock.calls.length
    resolveLoad()
    await task
    expect(getListeningRanking).toHaveBeenCalledTimes(rankings)
    expect(getLikedPlaylist).toHaveBeenCalledTimes(likes)
    expect(getRecommendPlaylists).toHaveBeenCalledTimes(refills)
  })
})
