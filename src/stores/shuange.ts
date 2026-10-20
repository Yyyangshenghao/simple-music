import { create } from 'zustand'
import { serviceFor } from '../lib/service-registry'
import { computeHighlightOffset, type HighlightRange } from '../lib/highlight-offset'
import { usePlayerStore } from './player'
import { usePlaylistStore } from './playlist'
import { useNavigationStore } from './navigation'
import { useLikesStore } from './likes'
import { useProviderStore } from './providers'
import { getPreloadedResolution, preloadTracks, preloadTrackUrl, releasePreloadWindow } from '../lib/track-preload'
import { providerAccountSession } from '../lib/provider-account-session'
import { prepareShuangeAudio, releaseShuangeAudio, waitForShuangeAudio } from '../lib/shuange-audio-preload'
import {
  getShuangeFeedContext,
  hydrateShuangeTaste,
  isShuangeFeedCurrent,
  prepareShuangeBatch,
  resetShuangeFeedCache,
  shuangeSource,
  type ShuangeFeedContext,
} from '../lib/shuange-feed'
import {
  recordShuangeExposure,
  recordShuangeFeedback,
  flushShuangeRecommendationProfile,
} from '../lib/shuange-recommendation'
import { beginPlaybackIntent, isCurrentPlaybackIntent, isPlaybackPauseIntent } from '../lib/playback-intent'
import type { AudioQuality, Track } from '../types/domain'

const OFFSET_CACHE_MAX = 200
const HIGHLIGHT_WAIT_MS = 90
const QUICK_SKIP_SEC = 6
const LISTENED_SEC = 18
const HISTORY_LIMIT = 100
const PRELOAD_INTERVAL_MS = 100
const PRELOAD_CONCURRENCY = 2
export const SHUANGE_COVER_PX = 768

/** 竞态守卫:每次 enter / loadIndex 递增,leave 也递增以作废在途异步 */
let shuangeSession = 0
let offsetGeneration = 0
let currentFeedbackKey = ''
let currentMaxProgressSec = 0
let currentHadPlayback = false
let preloadTimer: ReturnType<typeof setTimeout> | null = null
let lastPreloadAt = -Infinity
let prewarmAllowed = false
let pendingAudioIndex: number | null = null
let queuedResources: Array<{ track: Track; quality: AudioQuality }> = []
const runningResources = new Set<string>()

/** 测试用:清空 offset LRU 缓存 */
export function __resetOffsetCache(): void {
  offsetGeneration++
  offsetCache.clear()
  offsetPreloads.clear()
  runningResources.clear()
  stopPreloading()
  resetShuangeFeedCache()
}

interface ShuangeSnapshot {
  currentTrack: Track | null
  queue: Track[]
  queueIndex: number
  shuffleOrder: number[]
  queueContextId: unknown
  position: number
  volume: number
  wasPlaying: boolean
}

interface ShuangeStore {
  active: boolean
  feed: Track[]
  index: number
  historyEnd: number
  direction: 1 | -1
  offset: HighlightRange | null
  loading: boolean
  error: string | null
  stage: 'candidates' | 'highlight' | 'playback' | null
  preloadWindow: Track[]
  warmup(): Promise<void>
  enter(): Promise<void>
  refresh(): Promise<void>
  leave(): void
  next(canAdvance?: () => boolean): Promise<void>
  prev(): Promise<void>
  playFullCurrent(): void
  notInterestedCurrent(): Promise<void>
  toggleLike(track: Track): Promise<void>
  loadIndex(i: number): Promise<void>
}

const offsetCache = new Map<string, HighlightRange>()
const offsetPreloads = new Map<string, Promise<HighlightRange>>()
function cacheKey(track: Track): string {
  const session = track.source === 'local' ? 0 : providerAccountSession(track.source)
  return `${track.source}:${session}:${String(track.id)}`
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
  const generation = offsetGeneration
  const task = (async () => {
    let range: HighlightRange
    try {
      const lines = await serviceFor(track.source).getLyrics(track)
      range = computeHighlightOffset(lines ?? [], track.duration ?? 0)
    } catch {
      range = computeHighlightOffset([], track.duration ?? 0)
    }
    if (generation === offsetGeneration && cacheKey(track) === key) rememberOffset(key, range)
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

/* 旧单向预热窗口 已改为前后各两首及备用批首曲
function prepareWindow(feed: Track[], index: number): void {
  const current = feed[index]
  if (!current) return
  const neighbors = [feed[index - 1], feed[index + 1], feed[index + 2], feed[index + 3]]
    .filter((item): item is Track => !!item)
  const player = usePlayerStore.getState()
  preloadTracks(neighbors, player.quality, current, { coverPx: SHUANGE_COVER_PX })
  for (const track of [feed[index + 1], feed[index + 2]]) {
    if (track) void ensureOffset(track)
  }
}
*/

/** 清理刷歌自己的补货调度和资源窗口 */
function stopPreloading(): void {
  pendingAudioIndex = null
  releaseShuangeAudio()
  prewarmAllowed = false
  if (preloadTimer) clearTimeout(preloadTimer)
  preloadTimer = null
  lastPreloadAt = -Infinity
  queuedResources = []
  releasePreloadWindow('shuange')
  useShuangeStore.setState({ preloadWindow: [] })
}

/** 在最多两个后台任务内准备歌曲地址和选段 */
function runPreloadQueue(): void {
  while (runningResources.size < PRELOAD_CONCURRENCY && queuedResources.length) {
    const { track, quality } = queuedResources.shift()!
    const key = `${offsetGeneration}:${cacheKey(track)}:${quality}`
    if (runningResources.has(key)) continue
    const hasUrl = track.source === 'apple' || track.source === 'local' || !!track.url || !!getPreloadedResolution(track, quality)
    if (cachedOffset(track) && hasUrl) continue
    runningResources.add(key)
    void Promise.allSettled([preloadTrackUrl(track, quality), ensureOffset(track)]).finally(() => {
      runningResources.delete(key)
      runPreloadQueue()
      prepareAudioWindow()
    })
  }
}

/** 当前曲已起播后才准备相邻音频 登录预热不读取音频 */
function prepareAudioWindow(): void {
  const state = useShuangeStore.getState()
  const player = usePlayerStore.getState()
  if (!state.active || state.loading || state.index < 0 || player.status !== 'playing' || typeof Audio === 'undefined') return
  if (!String(player.contextId).startsWith('shuange:')) return
  const target = getShuangeFeedContext()
  const feed = [...state.feed, ...(target?.standby ?? [])]
  const targets = [1, -1, 2, -2].map(step => feed[state.index + step * state.direction])
    .flatMap(track => {
      const range = track && cachedOffset(track)
      return track && range ? [{ track, startAt: range.startSec }] : []
    })
  prepareShuangeAudio(player._engine(), targets, player.quality)
}

/** 根据最新位置合并双向窗口 旧调度不保留过时曲目 */
function prepareResourceWindow(): void {
  lastPreloadAt = Date.now()
  preloadTimer = null
  const state = useShuangeStore.getState()
  if (!state.active && !prewarmAllowed) return
  const target = getShuangeFeedContext()
  if (!target) return
  const browsing = state.active && state.index >= 0
  const feed = [...(browsing ? state.feed : target.current), ...target.standby]
  const index = browsing ? state.index : 0
  const current = feed[index]
  if (!current) return
  const direction = state.direction
  const ordered = [current, feed[index + direction], feed[index - direction], feed[index + 2 * direction], feed[index - 2 * direction], target.standby[0]]
    .filter((track): track is Track => !!track)
  const tracks = [...new Map(ordered.map(track => [cacheKey(track), track])).values()]
  // 镜像最多六首到可见界面 宿主不解码封面
  useShuangeStore.setState({ preloadWindow: tracks })
  const quality = usePlayerStore.getState().quality
  preloadTracks(tracks, quality, current, { owner: 'shuange', coverPx: SHUANGE_COVER_PX, deferUrls: true })
  queuedResources = tracks.map(track => ({ track, quality }))
  runPreloadQueue()
  prepareAudioWindow()
}

/** 以 100 ms 合并连续操作 首次立即执行且尾次不丢失 */
function schedulePreload(): void {
  if (!prewarmAllowed && !useShuangeStore.getState().active) return
  const remaining = PRELOAD_INTERVAL_MS - (Date.now() - lastPreloadAt)
  if (remaining <= 0) {
    if (preloadTimer) clearTimeout(preloadTimer)
    prepareResourceWindow()
  } else if (!preloadTimer) preloadTimer = setTimeout(prepareResourceWindow, remaining)
}

/**
 * 异步补齐备用批 并在就绪后预热首曲
 *
 * @param target 当前来源上下文
 */
function prepareStandby(target: ShuangeFeedContext): Promise<Track[]> {
  return prepareShuangeBatch(target, 'standby', () => useShuangeStore.getState().feed).then(tracks => {
    if (isShuangeFeedCurrent(target)) schedulePreload()
    return tracks
  })
}

/** 后台补货失败保留可播放曲目 下一次操作允许重试 */
function replenish(): void {
  const target = getShuangeFeedContext()
  if (target?.current.length && !target.standby.length && !target.batches.standby) void prepareStandby(target).catch(() => {})
  schedulePreload()
}

let snapshot: ShuangeSnapshot | null = null

/** 刷歌期间持久化原队列及其断点，整曲接管或退出后恢复正常保存。 */
export function getShuangePlaybackSnapshot(): Pick<ShuangeSnapshot, 'queue' | 'queueIndex' | 'shuffleOrder' | 'position'> | null {
  return useShuangeStore.getState().active ? snapshot : null
}

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
    shuffleOrder: pl.shuffleOrder,
    queueContextId: pl.queueContextId,
    position: p.position ?? 0,
    volume: p.volume ?? 0.8,
    wasPlaying: p.status === 'playing' || p.status === 'loading',
  }
}

export const useShuangeStore = create<ShuangeStore>((set, get) => ({
  active: false,
  feed: [],
  index: -1,
  historyEnd: -1,
  direction: 1,
  offset: null,
  loading: false,
  error: null,
  stage: null,
  preloadWindow: [],

  /* 旧方案在 enter 和 refresh 内等待单批网络链路
  async enter() {
    const my = ++shuangeSession
    const feedId = ++feedSession
    currentFeedbackKey = ''
    currentMaxProgressSec = 0
    currentHadPlayback = false
    if (!get().active) snapshot = takeSnapshot()
    set({ active: true, feed: [], index: -1, direction: 1, offset: null, loading: true, error: null })
    try {
      if (my !== shuangeSession) return
      const providerState = useProviderStore.getState()
      const source = providerState.playbackOrder.find((id) =>
        providerState.byId[id].enabled && providerState.byId[id].auth === 'authenticated'
      )
      if (!source) throw new Error('请先启用至少一个音乐平台')
      const svc = serviceFor(source)
      // 新进入刷歌页从个性化页重新暖池；同一会话中的“换一批”不会重置这个游标。
      nextRecommendPage[source] = 0
      candidateRefills.delete(source)
      const songs = await takeOrRefillCandidateBatch(svc, source, CANDIDATE_BATCH_SIZE)
      if (my !== shuangeSession) return
      if (!songs.length) {
        set({ loading: false, error: '暂时没有推荐内容,稍后再来' })
        return
      }
      set({ feed: songs, index: -1, loading: false, error: null })
      await get().loadIndex(0)
      void hydrateShuangeTaste(svc, source)
      if (feedId === feedSession && get().active) void refillCandidatePool(svc, source, false)
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
      const providerState = useProviderStore.getState()
      const source = providerState.playbackOrder.find((id) =>
        providerState.byId[id].enabled && providerState.byId[id].auth === 'authenticated'
      )
      if (!source) throw new Error('请先启用至少一个音乐平台')
      const svc = serviceFor(source)
      const songs = await takeOrRefillCandidateBatch(svc, source, CANDIDATE_BATCH_SIZE)
      if (my !== shuangeSession) return
      if (!songs.length) {
        set({ loading: false, error: '暂时没有新的推荐内容,稍后再来' })
        return
      }
      set({ feed: songs, index: -1, direction: 1, offset: null, loading: false, error: null })
      await get().loadIndex(0)
      if (feedId === feedSession && get().active) void refillCandidatePool(svc, source, false)
    } catch (e) {
      if (my !== shuangeSession) return
      set({ loading: false, error: (e as Error)?.message || '加载失败' })
    }
  },
  */

  /** 登录就绪后准备双批数据 不接管普通播放 */
  async warmup() {
    prewarmAllowed = true
    const target = getShuangeFeedContext()
    if (!target) return
    await prepareShuangeBatch(target, 'current', () => get().active ? get().feed : [])
    if (!isShuangeFeedCurrent(target) || (!prewarmAllowed && !get().active)) return
    schedulePreload()
    if (target.current.length) {
      if (!target.standby.length && !target.batches.standby) void prepareStandby(target).catch(() => {})
      void hydrateShuangeTaste(target).catch(() => {})
    }
  },

  /** 实际进入时才保存普通播放快照并消费已准备的当前批 */
  async enter() {
    const my = ++shuangeSession
    if (!get().active) snapshot = takeSnapshot()
    resetCurrentListen()
    set({ active: true, feed: [], index: -1, historyEnd: -1, direction: 1, offset: null, loading: true, stage: 'candidates', error: null })
    try {
      const target = getShuangeFeedContext()
      if (!target) throw new Error('请先启用至少一个音乐平台')
      await get().warmup()
      if (my !== shuangeSession || !isShuangeFeedCurrent(target)) return
      if (!target.current.length) throw new Error('暂时没有推荐内容,稍后再来')
      set({ feed: target.current })
      await get().loadIndex(0)
    } catch (error) {
      if (my === shuangeSession) set({ loading: false, stage: null, error: (error as Error)?.message || '加载失败' })
    }
  },

  /** 手动换批直接晋升备用批并重置本轮历史 */
  async refresh() {
    if (!get().active) return get().enter()
    const my = ++shuangeSession
    const target = getShuangeFeedContext()
    if (!target) return
    set({ loading: true, stage: 'candidates', error: null })
    try {
      const tracks = await prepareStandby(target)
      if (my !== shuangeSession || !isShuangeFeedCurrent(target)) return
      if (!tracks.length) throw new Error('暂时没有新的推荐内容,稍后再来')
      recordCurrentListen(get())
      target.current = tracks
      target.standby = []
      set({ feed: tracks, index: -1, historyEnd: -1, direction: 1, offset: null })
      await get().loadIndex(0)
    } catch (error) {
      if (my === shuangeSession) set({ loading: false, stage: null, error: (error as Error)?.message || '加载失败' })
    }
  },

  /**
   * 切到指定曲目并裁剪超过上限的已消费历史
   *
   * @param i 已加载清单中的目标位置
   */
  async loadIndex(i) {
    const my = ++shuangeSession
    const previous = get()
    const { feed, index } = previous
    const track = feed[i]
    if (!track) return
    if (pendingAudioIndex !== null && i === index) {
      pendingAudioIndex = null
      set({ loading: false, stage: null })
      return
    }
    const historyEnd = Math.max(get().historyEnd, i)
    const trim = Math.max(0, historyEnd + 1 - HISTORY_LIMIT)
    const player = usePlayerStore.getState()
    const immediateRange = cachedOffset(track) ?? fallbackOffset(track)
    const remainingMs = player.status === 'playing' && previous.offset
      ? Math.max(0, (previous.offset.endSec - player.position) * 1000 / (player.rate || 1) - 250) : 0
    const pending = waitForShuangeAudio({ track, startAt: immediateRange.startSec }, player.quality, Math.min(800, remainingMs))
    if (pending) {
      const waitIntent = beginPlaybackIntent()
      pendingAudioIndex = i
      set({ loading: true, stage: 'playback', error: null })
      await pending
      if (my !== shuangeSession) return
      pendingAudioIndex = null
      if (!isCurrentPlaybackIntent(waitIntent)) {
        set({ loading: false, stage: null })
        return
      }
    }
    pendingAudioIndex = null
    recordCurrentListen(get())
    player.pause()
    const intent = beginPlaybackIntent()
    set({ feed: trim ? feed.slice(trim) : feed, index: i - trim, historyEnd: historyEnd - trim,
      direction: i < index ? -1 : 1, loading: true, stage: 'highlight', offset: immediateRange, error: null })
    recordShuangeExposure(track)
    replenish()
    try {
      const decision = await offsetWithinBudget(track)
      if (my !== shuangeSession) return
      const autoplay = isCurrentPlaybackIntent(intent)
      const current = usePlayerStore.getState()
      // 保留 2.4.0 的睡眠与后续播放意图守卫
      if (!autoplay && (!isPlaybackPauseIntent() || current.status !== 'paused' || current.currentTrack !== player.currentTrack)) {
        set({ feed: previous.feed, index: previous.index, historyEnd: previous.historyEnd,
          offset: previous.offset, direction: previous.direction, loading: false, stage: null })
        schedulePreload()
        return
      }
      set({ offset: decision.range, stage: 'playback' })
      await player.loadTrack(track, { startAt: decision.range.startSec, contextId: `shuange:${String(track.id)}`, autoplay, preservePlaybackIntent: true })
      if (my !== shuangeSession) return
      beginCurrentListen(track, decision.range.startSec)
      // 曝光已在实际切到时记录 不再等播放地址完成后重复记
      // recordShuangeExposure(track)
      set({ loading: false, stage: null })
      prepareAudioWindow()
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
    } catch (error) {
      if (my === shuangeSession) set({ loading: false, stage: null, error: (error as Error)?.message || '播放准备失败,请重试' })
    }
  },

  /* 旧方案耗尽 feed 后再追加网络返回结果
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
  */

  /**
   * 沿现有历史前进 到末尾才晋升备用批
   *
   * @param canAdvance 自动推进时检查睡眠和后续播放意图
   */
  async next(canAdvance) {
    if (!get().active || (canAdvance && !canAdvance())) return
    const { feed } = get()
    const index = pendingAudioIndex ?? get().index
    if (index + 1 < feed.length) {
      await get().loadIndex(index + 1)
      return
    }
    const my = ++shuangeSession
    const target = getShuangeFeedContext()
    if (!target) return
    try {
      const tracks = await prepareStandby(target)
      if (my !== shuangeSession || !get().active || !isShuangeFeedCurrent(target) || (canAdvance && !canAdvance())) return
      if (!tracks.length) throw new Error('暂时没有新的推荐内容,请重试')
      target.current = tracks
      target.standby = []
      set({ feed: [...feed, ...tracks], error: null })
      await get().loadIndex(index + 1)
    } catch (error) {
      if (my === shuangeSession) {
        pendingAudioIndex = null
        set({ loading: false, stage: null, error: (error as Error)?.message || '补充失败,请重试' })
      }
    }
  },

  /** 回看历史并补齐前后两首的资源 */
  async prev() {
    const index = pendingAudioIndex ?? get().index
    if (index > 0) {
      await get().loadIndex(index - 1)
    }
  },

  playFullCurrent() {
    ++shuangeSession // 作废在途 loadIndex/enter/next,防止覆盖整曲播放
    stopPreloading()
    const { feed, index } = get()
    const rest = feed.slice(index)
    if (!rest.length) return
    recordShuangeFeedback(rest[0], 'play-full')
    currentFeedbackKey = ''
    currentMaxProgressSec = 0
    currentHadPlayback = false
    snapshot = null
    retireCurrentBatch()
    set({ active: false, stage: null })
    // 交还原队列:用 feed 剩余作新队列从当前曲起播(整曲)
    usePlaylistStore.getState().setQueue(rest, 0)
    useNavigationStore.getState().navigateTo('explore')
  },

  async notInterestedCurrent() {
    const track = get().feed[get().index]
    if (!track) return
    resetCurrentListen()
    recordShuangeFeedback(track, 'not-interested')
    // 拒绝当前曲时立即暂停 不延续旧声音等待准备
    usePlayerStore.getState().pause()
    await get().next()
  },

  leave() {
    ++shuangeSession // 作废在途 enter/loadIndex/next
    stopPreloading()
    recordCurrentListen(get())
    const snap = snapshot
    snapshot = null
    retireCurrentBatch()
    set({ active: false, feed: [], index: -1, historyEnd: -1, loading: false, stage: null, error: null })
    if (!snap) return
    // 恢复原队列；是否继续播放严格跟随进入刷歌前的状态。
    usePlaylistStore.setState({
      queue: snap.queue,
      queueIndex: snap.queueIndex,
      shuffleOrder: snap.shuffleOrder,
      queueContextId: snap.queueContextId,
    })
    const p = usePlayerStore.getState()
    p.pause()
    p.setVolume(snap.volume)
    if (snap.currentTrack) {
      const restoreSession = shuangeSession
      void p.loadTrack(snap.currentTrack, {
        startAt: snap.position,
        contextId: snap.queueContextId,
        autoplay: snap.wasPlaying,
      })
        .then(() => {
          if (
            !snap.wasPlaying
            && restoreSession === shuangeSession
            && !useShuangeStore.getState().active
          ) {
            usePlayerStore.getState().pause()
          }
      })
    }
  },

  async toggleLike(track) {
    await useLikesStore.getState().toggleLike(track, true)
  },
}))

/* 旧模块级画像订阅已迁入宿主 initShuangeSession 统一释放
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
*/

/* 旧单批补货链路保留供对照 已由 shuange-feed 的双批缓存接管
// 首选启用音源变化 → 刷歌页重置 feed。
useProviderStore.subscribe((state, previous) => {
  if (state.playbackOrder[0] !== previous.playbackOrder[0] && useShuangeStore.getState().active) {
    void useShuangeStore.getState().enter()
  }
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
    const providerState = useProviderStore.getState()
    const source = providerState.playbackOrder.find((providerId) =>
      providerState.byId[providerId].enabled && providerState.byId[providerId].auth === 'authenticated'
    )
    if (!source) return
    const svc = serviceFor(source)
    const candidates = await takeOrRefillCandidateBatch(svc, source, CANDIDATE_BATCH_SIZE)
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

async function hydrateShuangeTaste(svc: MusicService, source: ProviderId): Promise<void> {
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

async function takeOrRefillCandidateBatch(
  svc: MusicService,
  source: ProviderId,
  count: number
): Promise<Track[]> {
  let batch = takeShuangeCandidateBatch(source, count)
  if (batch.length >= count) return batch
  await refillCandidatePool(svc, source, true)
  batch = [...batch, ...takeShuangeCandidateBatch(source, count - batch.length)]
  return batch
}

async function refillCandidatePool(
  svc: MusicService,
  source: ProviderId,
  includeDaily: boolean
): Promise<void> {
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
*/

/** 实际退出后保留备用批供下次进入 不重复消费刚结束的当前批 */
function retireCurrentBatch(): void {
  const target = getShuangeFeedContext()
  if (!target) return
  target.current = target.standby
  target.standby = []
}

let stopShuangeSession: (() => void) | undefined

/** 宿主持有登录预热和画像订阅 停止时作废在途任务且不恢复音频 */
export function initShuangeSession(): () => void {
  if (stopShuangeSession) return stopShuangeSession
  let stopped = false
  const identity = () => {
    const source = shuangeSource()
    return source ? `${source}:${providerAccountSession(source)}` : ''
  }
  let previousIdentity = identity()
  const unsubscribeProvider = useProviderStore.subscribe(() => {
    if (stopped) return
    const nextIdentity = identity()
    if (nextIdentity === previousIdentity) {
      schedulePreload()
      return
    }
    previousIdentity = nextIdentity
    stopPreloading()
    getShuangeFeedContext()
    if (useShuangeStore.getState().active) {
      if (shuangeSource()) void useShuangeStore.getState().enter()
      else useShuangeStore.getState().leave()
    } else void useShuangeStore.getState().warmup().catch(() => {})
  })
  // 导航进入和离开沿用 initShuangePlayback 的单一入口
  let quality = usePlayerStore.getState().quality
  let rate = usePlayerStore.getState().rate
  const unsubscribeQuality = usePlayerStore.subscribe(state => {
    if (quality === state.quality && rate === state.rate) return
    quality = state.quality
    rate = state.rate
    releaseShuangeAudio()
    schedulePreload()
  })
  let previousStatus = usePlayerStore.getState().status
  const unsubscribePlayer = usePlayerStore.subscribe(player => {
    const becamePlaying = player.status === 'playing' && previousStatus !== 'playing'
    previousStatus = player.status
    if (becamePlaying) prepareAudioWindow()
    const state = useShuangeStore.getState()
    const track = state.feed[state.index]
    if (stopped || !state.active || !track || !player.currentTrack || cacheKey(player.currentTrack) !== cacheKey(track)
      || currentFeedbackKey !== cacheKey(track) || player.status !== 'playing') return
    currentHadPlayback = true
    currentMaxProgressSec = Math.max(currentMaxProgressSec, player.position - (state.offset?.startSec ?? 0))
  })
  void useShuangeStore.getState().warmup().catch(() => {})
  stopShuangeSession = () => {
    if (stopped) return
    stopped = true
    unsubscribeProvider()
    unsubscribeQuality()
    unsubscribePlayer()
    ++shuangeSession
    ++offsetGeneration
    stopPreloading()
    resetShuangeFeedCache()
    recordCurrentListen(useShuangeStore.getState())
    flushShuangeRecommendationProfile()
    snapshot = null
    offsetPreloads.clear()
    offsetCache.clear()
    runningResources.clear()
    useShuangeStore.setState({ active: false, loading: false, stage: null })
    stopShuangeSession = undefined
  }
  return stopShuangeSession
}
