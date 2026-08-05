import { create } from 'zustand'
import { serviceFor } from '../lib/service-registry'
import { computeHighlightOffset, type HighlightRange } from '../lib/highlight-offset'
import { usePlayerStore } from './player'
import { usePlaylistStore } from './playlist'
import { useNavigationStore } from './navigation'
import { likeKeyOf, useLikesStore } from './likes'
import { preloadTracks } from '../lib/track-preload'
import {
  recordShuangeExposure,
  recordShuangeFeedback,
  seedShuangeTaste,
  stashShuangeCandidates,
  takeShuangeCandidateBatch,
} from '../lib/shuange-recommendation'
import type { MusicService } from '../lib/music-service'
import type { MusicSource, Playlist, Track } from '../types/domain'

const OFFSET_CACHE_MAX = 200
const HIGHLIGHT_WAIT_MS = 90
const QUICK_SKIP_SEC = 6
const LISTENED_SEC = 18
const FEED_APPEND_LIMIT = 40
const CANDIDATE_BATCH_SIZE = 12
export const SHUANGE_COVER_PX = 768

/** 竞态守卫:每次 enter / loadIndex 递增,leave 也递增以作废在途异步 */
let shuangeSession = 0
let feedSession = 0
const nextRecommendPage: Partial<Record<MusicSource, number>> = {}
let currentFeedbackKey = ''
let currentMaxProgressSec = 0
let currentHadPlayback = false
let appendInFlight: { feedId: number; promise: Promise<void> } | null = null
const candidateRefills = new Map<MusicSource, Promise<void>>()
const tasteHydrations = new Map<MusicSource, Promise<void>>()

/** 测试用:清空 offset LRU 缓存 */
export function __resetOffsetCache(): void {
  offsetCache.clear()
  offsetPreloads.clear()
}

interface ShuangeSnapshot {
  currentTrack: Track | null
  queue: Track[]
  queueIndex: number
  queueContextId: unknown
  position: number
  volume: number
}

interface ShuangeStore {
  active: boolean
  feed: Track[]
  index: number
  direction: 1 | -1
  offset: HighlightRange | null
  loading: boolean
  error: string | null
  enter(): Promise<void>
  refresh(): Promise<void>
  leave(): void
  next(): Promise<void>
  prev(): Promise<void>
  playFullCurrent(): void
  notInterestedCurrent(): Promise<void>
  toggleLike(track: Track): Promise<void>
  loadIndex(i: number): Promise<void>
}

const offsetCache = new Map<string, HighlightRange>()
const offsetPreloads = new Map<string, Promise<HighlightRange>>()
function cacheKey(track: Track): string {
  return `${track.source}:${String(track.id)}`
}
function rememberOffset(key: string, range: HighlightRange): void {
  if (offsetCache.has(key)) offsetCache.delete(key) // 重新插到末尾,保 LRU 顺序
  offsetCache.set(key, range)
  while (offsetCache.size > OFFSET_CACHE_MAX) {
    const first = offsetCache.keys().next().value
    if (first === undefined) break
    offsetCache.delete(first)
  }
}

async function ensureOffset(track: Track): Promise<HighlightRange> {
  const key = cacheKey(track)
  const cached = offsetCache.get(key)
  if (cached) {
    rememberOffset(key, cached)
    return cached
  }
  const pending = offsetPreloads.get(key)
  if (pending) return pending
  const task = (async () => {
    let range: HighlightRange
    try {
      const lines = await serviceFor(track.source).getLyrics(track)
      range = computeHighlightOffset(lines ?? [], track.duration ?? 0)
    } catch {
      range = computeHighlightOffset([], track.duration ?? 0)
    }
    rememberOffset(key, range)
    return range
  })()
  offsetPreloads.set(key, task)
  void task.finally(() => {
    if (offsetPreloads.get(key) === task) offsetPreloads.delete(key)
  })
  return task
}

function cachedOffset(track: Track): HighlightRange | undefined {
  const key = cacheKey(track)
  const range = offsetCache.get(key)
  if (range) rememberOffset(key, range)
  return range
}

function fallbackOffset(track: Track): HighlightRange {
  return computeHighlightOffset([], track.duration ?? 0)
}

interface OffsetDecision {
  range: HighlightRange
  refinement?: Promise<HighlightRange>
}

async function offsetWithinBudget(track: Track): Promise<OffsetDecision> {
  const cached = cachedOffset(track)
  if (cached) return { range: cached }
  const pending = ensureOffset(track)
  return new Promise((resolve) => {
    let settled = false
    const finish = (decision: OffsetDecision) => {
      if (settled) return
      settled = true
      globalThis.clearTimeout(timer)
      resolve(decision)
    }
    const timer = globalThis.setTimeout(
      () => finish({ range: fallbackOffset(track), refinement: pending }),
      HIGHLIGHT_WAIT_MS
    )
    void pending.then((range) => finish({ range }))
  })
}

function sameRange(a: HighlightRange, b: HighlightRange): boolean {
  return a.startSec === b.startSec && a.endSec === b.endSec && a.kind === b.kind
}

function prepareWindow(feed: Track[], index: number): void {
  const current = feed[index]
  if (!current) return
  const neighbors = [feed[index - 1], feed[index + 1], feed[index + 2]]
    .filter((item): item is Track => !!item)
  const player = usePlayerStore.getState()
  preloadTracks(neighbors, player.quality, current, { coverPx: SHUANGE_COVER_PX })
  for (const track of [feed[index + 1], feed[index + 2]]) {
    if (track) void ensureOffset(track)
  }
}

let snapshot: ShuangeSnapshot | null = null

function resetCurrentListen(): void {
  currentFeedbackKey = ''
  currentMaxProgressSec = 0
  currentHadPlayback = false
}

function recordCurrentListen(state: ShuangeStore): void {
  const track = state.feed[state.index]
  const matches = track && currentFeedbackKey === cacheKey(track)
  const progress = currentMaxProgressSec
  const hadPlayback = currentHadPlayback
  resetCurrentListen()
  if (!track || !matches || !hadPlayback) return
  if (progress < QUICK_SKIP_SEC) recordShuangeFeedback(track, 'quick-skip')
  else if (progress >= LISTENED_SEC) recordShuangeFeedback(track, 'listened')
}

function beginCurrentListen(track: Track, startSec: number): void {
  const player = usePlayerStore.getState()
  currentFeedbackKey = cacheKey(track)
  currentMaxProgressSec = Math.max(0, player.position - startSec)
  currentHadPlayback = player.status === 'playing'
}

function takeSnapshot(): ShuangeSnapshot {
  const p = usePlayerStore.getState()
  const pl = usePlaylistStore.getState()
  return {
    currentTrack: p.currentTrack ?? null,
    queue: pl.queue,
    queueIndex: pl.queueIndex,
    queueContextId: pl.queueContextId,
    position: p.position ?? 0,
    volume: p.volume ?? 0.8,
  }
}

export const useShuangeStore = create<ShuangeStore>((set, get) => ({
  active: false,
  feed: [],
  index: -1,
  direction: 1,
  offset: null,
  loading: false,
  error: null,

  async enter() {
    const my = ++shuangeSession
    const feedId = ++feedSession
    currentFeedbackKey = ''
    currentMaxProgressSec = 0
    currentHadPlayback = false
    if (!get().active) snapshot = takeSnapshot()
    set({ active: true, feed: [], index: -1, direction: 1, offset: null, loading: true, error: null })
    try {
      const { useSettingsStore } = await import('./settings')
      if (my !== shuangeSession) return
      const svc = serviceFor(useSettingsStore.getState().activeSource)
      const source = useSettingsStore.getState().activeSource
      // 新进入刷歌页从个性化页重新暖池；同一会话中的“换一批”不会重置这个游标。
      nextRecommendPage[source] = 0
      candidateRefills.delete(source)
      const songs = await takeOrRefillCandidateBatch(svc, CANDIDATE_BATCH_SIZE)
      if (my !== shuangeSession) return
      if (!songs.length) {
        set({ loading: false, error: '暂时没有推荐内容,稍后再来' })
        return
      }
      set({ feed: songs, index: -1, loading: false, error: null })
      await get().loadIndex(0)
      void hydrateShuangeTaste(svc)
      if (feedId === feedSession && get().active) void refillCandidatePool(svc, false)
    } catch (e) {
      if (my !== shuangeSession) return
      set({ loading: false, error: (e as Error)?.message || '加载失败' })
    }
  },

  async refresh() {
    if (!get().active) return get().enter()
    const my = ++shuangeSession
    const feedId = ++feedSession
    recordCurrentListen(get())
    set({ loading: true, error: null })
    try {
      const { useSettingsStore } = await import('./settings')
      const svc = serviceFor(useSettingsStore.getState().activeSource)
      const songs = await takeOrRefillCandidateBatch(svc, CANDIDATE_BATCH_SIZE)
      if (my !== shuangeSession) return
      if (!songs.length) {
        set({ loading: false, error: '暂时没有新的推荐内容,稍后再来' })
        return
      }
      set({ feed: songs, index: -1, direction: 1, offset: null, loading: false, error: null })
      await get().loadIndex(0)
      if (feedId === feedSession && get().active) void refillCandidatePool(svc, false)
    } catch (e) {
      if (my !== shuangeSession) return
      set({ loading: false, error: (e as Error)?.message || '加载失败' })
    }
  },

  async loadIndex(i) {
    const my = ++shuangeSession
    const { feed, index } = get()
    const track = feed[i]
    if (!track) return
    prepareWindow(feed, i)
    const player = usePlayerStore.getState()
    player.pause()
    const immediateRange = cachedOffset(track) ?? fallbackOffset(track)
    set({ index: i, direction: i < index ? -1 : 1, loading: true, offset: immediateRange, error: null })
    const decision = await offsetWithinBudget(track)
    if (my !== shuangeSession) return
    set({ offset: decision.range })
    await player.loadTrack(track, { startAt: decision.range.startSec, contextId: `shuange:${String(track.id)}` })
    if (my !== shuangeSession) return
    beginCurrentListen(track, decision.range.startSec)
    recordShuangeExposure(track)
    set({ loading: false })
    if (decision.refinement) {
      void decision.refinement.then((range) => {
        const state = get()
        const current = state.feed[state.index]
        if (my !== shuangeSession || !state.active || !current || cacheKey(current) !== cacheKey(track)) return
        if (sameRange(range, decision.range)) return
        const currentPlayer = usePlayerStore.getState()
        if (!currentPlayer.currentTrack || cacheKey(currentPlayer.currentTrack) !== cacheKey(track)) return
        if (currentPlayer.status !== 'playing' && currentPlayer.status !== 'loading') return
        set({ offset: range })
        currentPlayer.seek(range.startSec)
      })
    }
  },

  async next() {
    const { feed, index } = get()
    if (index + 1 < feed.length) {
      recordCurrentListen(get())
      await get().loadIndex(index + 1)
      return
    }
    // feed 耗尽:用 recommend/playlists 补
    const my = shuangeSession
    await appendMoreFeed(get, set)
    if (my !== shuangeSession) return
    const after = get()
    if (index + 1 < after.feed.length) {
      recordCurrentListen(after)
      await get().loadIndex(index + 1)
    }
  },

  async prev() {
    const { index } = get()
    if (index > 0) {
      recordCurrentListen(get())
      await get().loadIndex(index - 1)
    }
  },

  playFullCurrent() {
    ++shuangeSession // 作废在途 loadIndex/enter/next,防止覆盖整曲播放
    ++feedSession
    const { feed, index } = get()
    const rest = feed.slice(index)
    if (!rest.length) return
    recordShuangeFeedback(rest[0], 'play-full')
    currentFeedbackKey = ''
    currentMaxProgressSec = 0
    currentHadPlayback = false
    snapshot = null
    set({ active: false })
    // 交还原队列:用 feed 剩余作新队列从当前曲起播(整曲)
    usePlaylistStore.getState().setQueue(rest, 0)
    useNavigationStore.getState().navigateTo('explore')
  },

  async notInterestedCurrent() {
    const track = get().feed[get().index]
    if (!track) return
    resetCurrentListen()
    recordShuangeFeedback(track, 'not-interested')
    await get().next()
  },

  leave() {
    ++shuangeSession // 作废在途 enter/loadIndex/next
    ++feedSession
    recordCurrentListen(get())
    const snap = snapshot
    snapshot = null
    set({ active: false })
    if (!snap) return
    // 恢复原队列(暂停态):setState 不触发 playAt 自动开播
    usePlaylistStore.setState({
      queue: snap.queue,
      queueIndex: snap.queueIndex,
      queueContextId: snap.queueContextId,
    })
    const p = usePlayerStore.getState()
    p.pause()
    p.setVolume(snap.volume)
    if (snap.currentTrack) {
      const restoreSession = shuangeSession
      void p.loadTrack(snap.currentTrack, { startAt: snap.position, contextId: snap.queueContextId })
        .then(() => {
          if (restoreSession === shuangeSession && !useShuangeStore.getState().active) {
            usePlayerStore.getState().pause()
          }
      })
    }
  },

  async toggleLike(track) {
    const likes = useLikesStore.getState()
    const before = likes.likedByKey[likeKeyOf(track)] ?? false
    await likes.toggleLike(track)
    const after = useLikesStore.getState().likedByKey[likeKeyOf(track)] ?? false
    if (after !== before) recordShuangeFeedback(track, after ? 'like' : 'unlike')
  },
}))

// 只累计真正处于 playing 的片段进度；loading、暂停和后台挂起都不计入画像。
usePlayerStore.subscribe((player) => {
  const state = useShuangeStore.getState()
  const track = state.feed[state.index]
  if (!state.active || !track || currentFeedbackKey !== cacheKey(track) || player.status !== 'playing') return
  currentHadPlayback = true
  currentMaxProgressSec = Math.max(
    currentMaxProgressSec,
    player.position - (state.offset?.startSec ?? 0)
  )
})

// 切音源 → 刷歌页重置 feed(spec 八边界明文要求)
// 动态 import 避免初始化期循环依赖(与 enter 内同)
void import('./settings').then(({ useSettingsStore }) => {
  useSettingsStore.subscribe((s, prev) => {
    if (s.activeSource !== prev?.activeSource && useShuangeStore.getState().active) {
      void useShuangeStore.getState().enter()
    }
  })
})

// feed 补充优先消费本地候选池；只有库存不足时才等待网络补货。
async function appendMoreFeed(get: () => ShuangeStore, set: (p: Partial<ShuangeStore>) => void): Promise<void> {
  const id = feedSession
  if (appendInFlight?.feedId === id) return appendInFlight.promise
  const promise = fetchAndAppendMoreFeed(id, get, set)
  appendInFlight = { feedId: id, promise }
  void promise.finally(() => {
    if (appendInFlight?.promise === promise) appendInFlight = null
  })
  return promise
}

async function fetchAndAppendMoreFeed(
  id: number,
  get: () => ShuangeStore,
  set: (p: Partial<ShuangeStore>) => void
): Promise<void> {
  try {
    const { useSettingsStore } = await import('./settings')
    const svc = serviceFor(useSettingsStore.getState().activeSource)
    const candidates = await takeOrRefillCandidateBatch(svc, CANDIDATE_BATCH_SIZE)
    if (id !== feedSession || !get().active) return
    const current = get().feed
    const known = new Set(current.map(cacheKey))
    const more = candidates.filter((track) => !known.has(cacheKey(track))).slice(0, FEED_APPEND_LIMIT)
    if (more.length) set({ feed: [...current, ...more] })
  } catch {
    // 补充失败静默;next 会原地不动
  }
}

function pickPlaylists<T>(items: T[], count: number): T[] {
  const pool = [...items]
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const swap = pool[i]
    pool[i] = pool[j]
    pool[j] = swap
  }
  return pool.slice(0, count)
}

function withPlaylistHints(track: Track, playlist: Playlist): Track {
  const previous = Array.isArray(track.recommendationHints)
    ? track.recommendationHints.filter((hint): hint is string => typeof hint === 'string')
    : []
  const hints = [playlist.name, playlist.tag, playlist.description].filter((hint): hint is string => !!hint)
  return { ...track, recommendationHints: [...new Set([...previous, ...hints])].slice(0, 4) }
}

interface FeedCandidateResult {
  tracks: Track[]
  pageReady: boolean
}

async function fetchFeedCandidates(svc: MusicService, page: number, includeRadar: boolean): Promise<FeedCandidateResult> {
  const [radarResult, playlistsResult] = await Promise.allSettled([
    includeRadar && svc.getRadarPlaylist ? svc.getRadarPlaylist() : Promise.resolve(null),
    svc.getRecommendPlaylists(page),
  ])
  const radarTracks = radarResult.status === 'fulfilled' ? radarResult.value?.tracks ?? [] : []
  const playlists = playlistsResult.status === 'fulfilled' ? playlistsResult.value : []
  const selectedPlaylists = pickPlaylists(playlists, 2)
  const skeletons = await Promise.allSettled(
    selectedPlaylists.map((playlist) => svc.getPlaylistSkeleton(playlist.id))
  )
  return {
    tracks: [
      ...radarTracks,
      ...skeletons.flatMap((result, index) => result.status === 'fulfilled'
        ? result.value.tracks.map((track) => withPlaylistHints(track, selectedPlaylists[index]))
        : []),
    ],
    // 歌单页请求失败时保留游标，后续补货会重试这一页，而不是静默跳过去。
    pageReady: playlistsResult.status === 'fulfilled',
  }
}

async function hydrateShuangeTaste(svc: MusicService): Promise<void> {
  const { useSettingsStore } = await import('./settings')
  const source = useSettingsStore.getState().activeSource
  const pending = tasteHydrations.get(source)
  if (pending) return pending
  const task = (async () => {
    const [rankingResult, likedResult] = await Promise.allSettled([
      svc.getListeningRanking?.() ?? Promise.resolve([]),
      svc.getLikedPlaylist?.() ?? Promise.resolve(null),
    ])
    const rankedTracks = rankingResult.status === 'fulfilled' ? rankingResult.value : []
    let likedTracks: Track[] = []
    if (likedResult.status === 'fulfilled' && likedResult.value) {
      try {
        likedTracks = (await svc.getPlaylistSkeleton(likedResult.value.id)).tracks
      } catch {
        // 口味导入失败不影响刷歌首屏和候选补货。
      }
    }
    seedShuangeTaste(source, rankedTracks, likedTracks)
  })()
  tasteHydrations.set(source, task)
  void task.finally(() => {
    if (tasteHydrations.get(source) === task) tasteHydrations.delete(source)
  }).catch(() => {})
  return task
}

async function takeOrRefillCandidateBatch(svc: MusicService, count: number): Promise<Track[]> {
  const { useSettingsStore } = await import('./settings')
  const source = useSettingsStore.getState().activeSource
  let batch = takeShuangeCandidateBatch(source, count)
  if (batch.length >= count) return batch
  await refillCandidatePool(svc, true)
  batch = [...batch, ...takeShuangeCandidateBatch(source, count - batch.length)]
  return batch
}

async function refillCandidatePool(svc: MusicService, includeDaily: boolean): Promise<void> {
  const { useSettingsStore } = await import('./settings')
  const source = useSettingsStore.getState().activeSource
  const pending = candidateRefills.get(source)
  if (pending) return pending
  const page = nextRecommendPage[source] ?? 0
  const task = (async () => {
    const [dailyResult, feedResult] = await Promise.allSettled([
      includeDaily ? svc.getDailySongs?.() ?? Promise.resolve([]) : Promise.resolve([]),
      fetchFeedCandidates(svc, page, page === 0),
    ])
    const daily = dailyResult.status === 'fulfilled' ? dailyResult.value : []
    const feed = feedResult.status === 'fulfilled' ? feedResult.value.tracks : []
    if (includeDaily && dailyResult.status === 'rejected' && feed.length === 0) throw dailyResult.reason
    if (feedResult.status === 'fulfilled' && feedResult.value.pageReady) nextRecommendPage[source] = page + 1
    stashShuangeCandidates([...daily, ...feed])
  })()
  candidateRefills.set(source, task)
  void task.finally(() => {
    if (candidateRefills.get(source) === task) candidateRefills.delete(source)
  }).catch(() => {})
  return task
}
