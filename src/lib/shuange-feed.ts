import { useProviderStore } from '../stores/providers'
import { providerAccountSession } from './provider-account-session'
import { BROWSE_CACHE_MAX_AGE_MS, requestProviderData } from './provider-request-cache'
import { serviceFor } from './service-registry'
import {
  clearShuangeCandidates,
  countShuangeCandidates,
  hasShuangeTaste,
  seedShuangeTaste,
  stashShuangeCandidates,
  takeShuangeCandidateBatch,
} from './shuange-recommendation'
import type { RecommendationPage, ProviderId } from '../providers/types'
import type { Playlist, Track } from '../types/domain'

export const SHUANGE_BATCH_SIZE = 12

export interface ShuangeFeedContext {
  source: ProviderId
  accountSession: number
  current: Track[]
  standby: Track[]
  page: number
  dailyLoadedOn: string | null
  batches: Partial<Record<'current' | 'standby', Promise<Track[]>>>
  refill: Promise<void> | null
  taste: Promise<void> | null
  updates: Set<() => void>
}

let context: ShuangeFeedContext | null = null
const knownAccountSessions = new Map<ProviderId, number>()

/** 获取当前已就绪且可参与刷歌的首选来源 */
export function shuangeSource(): ProviderId | undefined {
  const state = useProviderStore.getState()
  return state.playbackOrder.find(id => {
    const provider = state.byId[id]
    return provider.enabled && provider.auth === 'authenticated' && provider.playbackAvailable !== false
  })
}

/**
 * 检查请求是否仍属于当前来源与账号
 *
 * @param target 请求捕获的批次上下文
 */
export function isShuangeFeedCurrent(target: ShuangeFeedContext): boolean {
  return context === target && shuangeSource() === target.source
    && providerAccountSession(target.source) === target.accountSession
}

/**
 * 唤醒等待独立来源返回的批次生成任务
 *
 * @param target 需要唤醒的上下文
 */
function notifyCandidates(target: ShuangeFeedContext): void {
  for (const resolve of target.updates) resolve()
  target.updates.clear()
}

/** 失效旧批次 迟到结果不得回写 */
export function resetShuangeFeedCache(): void {
  const previous = context
  context = null
  if (previous) notifyCandidates(previous)
}

/** 获取或建立单一来源的双批缓存 */
export function getShuangeFeedContext(): ShuangeFeedContext | null {
  const source = shuangeSource()
  if (context && isShuangeFeedCurrent(context)) return context
  resetShuangeFeedCache()
  if (!source) return null
  const accountSession = providerAccountSession(source)
  const knownSession = knownAccountSessions.get(source)
  if (knownSession !== undefined && knownSession !== accountSession) clearShuangeCandidates(source)
  knownAccountSessions.set(source, accountSession)
  context = {
    source, accountSession, current: [], standby: [],
    page: 0, dailyLoadedOn: null, batches: {}, refill: null, taste: null, updates: new Set(),
  }
  return context
}

/**
 * 获取已占用歌曲 防止补货把历史重新加入队尾
 *
 * @param target 当前双批缓存
 * @param history 已加载的历史和当前批曲目
 */
function occupiedKeys(target: ShuangeFeedContext, history: Track[]): Set<string> {
  return new Set([...target.current, ...target.standby, ...history].map(track => `${track.source}:${String(track.id)}`))
}

/**
 * 独立来源就绪后立即入池
 *
 * @param target 请求所属上下文
 * @param tracks 返回曲目
 */
function publishCandidates(target: ShuangeFeedContext, tracks: Track[]): void {
  if (!isShuangeFeedCurrent(target)) return
  stashShuangeCandidates(tracks.filter(track => track.source === target.source))
  notifyCandidates(target)
}

/**
 * 复用首页同一推荐数据面的响应和在途查询
 *
 * @param target 当前来源上下文
 * @param kind 推荐数据面
 * @param page 歌单页码
 */
function recommendationPage(target: ShuangeFeedContext, kind: 'daily' | 'radar' | 'playlists', page = 0): Promise<RecommendationPage> {
  const { source } = target
  const service = serviceFor(source)
  const surface = kind === 'daily' ? (source === 'qq' ? 'radio' : 'daily-songs')
    : kind === 'radar' ? 'radar' : 'playlist-feed'
  const day = source === 'netease' && kind === 'daily' ? `:${new Date().toDateString()}` : ''
  const scope = source === 'apple' ? `shuange:${surface}:${page}`
    : `recommendation:${source}:${surface}:${page ? String(page) : 'root'}${day}`
  // 电台后续补货和跨日日推绕过已完成缓存，仍复用在途请求。
  const force = kind === 'daily' && target.dailyLoadedOn !== null
  return requestProviderData(source, scope, async () => {
    if (kind === 'daily') {
      const tracks = await (service.getRadioSongs?.() ?? service.getDailySongs?.()) ?? []
      return { content: { type: 'tracks', tracks }, hasMore: source === 'qq' && tracks.length > 0 }
    }
    if (kind === 'radar') {
      return { content: { type: 'radar', radar: await service.getRadarPlaylist?.() ?? null }, hasMore: false }
    }
    const playlists = await service.getRecommendPlaylists(page) ?? []
    return {
      content: { type: 'playlists', playlists },
      hasMore: playlists.length > 0,
      nextCursor: playlists.length ? String(page + 1) : undefined,
    }
  }, { force, maxAgeMs: BROWSE_CACHE_MAX_AGE_MS })
}

/**
 * 查询来源歌单并补上原有推荐提示
 *
 * @param target 请求所属上下文
 * @param playlist 来源歌单
 */
async function loadPlaylistCandidates(target: ShuangeFeedContext, playlist: Playlist): Promise<void> {
  const skeleton = await requestProviderData(target.source, `shuange:playlist:${String(playlist.id)}`,
    () => serviceFor(target.source).getPlaylistSkeleton(playlist.id), { maxAgeMs: BROWSE_CACHE_MAX_AGE_MS })
  const hints = [playlist.name, playlist.tag, playlist.description].filter((hint): hint is string => !!hint)
  publishCandidates(target, (skeleton?.tracks ?? []).map(track => {
    const previous = Array.isArray(track.recommendationHints)
      ? track.recommendationHints.filter((hint): hint is string => typeof hint === 'string') : []
    return { ...track, recommendationHints: [...new Set([...previous, ...hints])].slice(0, 4) }
  }))
}

/**
 * 并行补货 各来源分别入池 歌单列表不等待雷达
 *
 * @param target 当前来源上下文
 */
function refillCandidates(target: ShuangeFeedContext): Promise<void> {
  if (target.refill) return target.refill
  const page = target.page
  const day = new Date().toDateString()
  const daily = target.dailyLoadedOn === day && target.source !== 'qq' ? Promise.resolve() : recommendationPage(target, 'daily').then(result => {
    if (!isShuangeFeedCurrent(target)) return
    target.dailyLoadedOn = day
    publishCandidates(target, result.content.type === 'tracks' ? result.content.tracks : [])
  })
  const radar = page ? Promise.resolve() : recommendationPage(target, 'radar').then(result => {
    publishCandidates(target, result.content.type === 'radar' ? result.content.radar?.tracks ?? [] : [])
  })
  const playlists = recommendationPage(target, 'playlists', page).then(async result => {
    if (!isShuangeFeedCurrent(target)) return
    target.page = page + 1
    const pool = result.content.type === 'playlists' ? [...result.content.playlists] : []
    const chosen: Playlist[] = []
    while (pool.length && chosen.length < 2) chosen.push(...pool.splice(Math.floor(Math.random() * pool.length), 1))
    await Promise.allSettled(chosen.map(playlist => loadPlaylistCandidates(target, playlist)))
  })
  const task = Promise.allSettled([daily, radar, playlists]).then(results => {
    const failure = results.find(result => result.status === 'rejected')
    if (failure?.status === 'rejected' && !countShuangeCandidates(target.source, new Set())) throw failure.reason
  }).finally(() => {
    if (target.refill === task) target.refill = null
    notifyCandidates(target)
  })
  target.refill = task
  return task
}

/**
 * 生成缺失批次 满足数量即返回 不等待全部慢来源
 *
 * @param target 双批上下文
 * @param slot 当前批或备用批
 * @param history 获取最新已加载清单
 */
export function prepareShuangeBatch(target: ShuangeFeedContext, slot: 'current' | 'standby', history: () => Track[]): Promise<Track[]> {
  if (target[slot].length) return Promise.resolve(target[slot])
  const pending = target.batches[slot]
  if (pending) return pending
  const task = (async () => {
    // 退出时备用批可能还在准备；重新进入应等待并晋升它，避免将现有曲目排除后另行补货。
    if (slot === 'current' && (target.standby.length || target.batches.standby)) {
      const tracks = await prepareShuangeBatch(target, 'standby', history)
      if (!isShuangeFeedCurrent(target)) return []
      target.current = tracks
      target.standby = []
      return tracks
    }
    let excluded = occupiedKeys(target, history())
    if (countShuangeCandidates(target.source, excluded) < SHUANGE_BATCH_SIZE) {
      let finished = false
      let failure: unknown
      const refill = refillCandidates(target).catch(error => { failure = error }).finally(() => { finished = true })
      while (isShuangeFeedCurrent(target) && !finished && countShuangeCandidates(target.source, excluded) < SHUANGE_BATCH_SIZE) {
        let wake!: () => void
        const changed = new Promise<void>(resolve => { wake = resolve })
        target.updates.add(wake)
        await Promise.race([refill, changed])
        target.updates.delete(wake)
        excluded = occupiedKeys(target, history())
      }
      if (isShuangeFeedCurrent(target) && !countShuangeCandidates(target.source, excluded) && failure) throw failure
    }
    if (!isShuangeFeedCurrent(target)) return []
    const tracks = takeShuangeCandidateBatch(target.source, SHUANGE_BATCH_SIZE, excluded)
    target[slot] = tracks
    return tracks
  })().finally(() => {
    if (target.batches[slot] === task) delete target.batches[slot]
  })
  target.batches[slot] = task
  return task
}

/**
 * 当天口味只导入一次 且旧账号结果不得写回
 *
 * @param target 当前来源上下文
 */
export function hydrateShuangeTaste(target: ShuangeFeedContext): Promise<void> {
  if (hasShuangeTaste(target.source)) return Promise.resolve()
  if (target.taste) return target.taste
  const service = serviceFor(target.source)
  const task = (async () => {
    const [ranking, liked] = await Promise.allSettled([
      requestProviderData(target.source, 'shuange:ranking', async () => await (service.getListeningRanking?.()
        ?? service.getRecentTracks?.().then(tracks => tracks.slice(0, 100))) ?? [], { maxAgeMs: BROWSE_CACHE_MAX_AGE_MS }),
      requestProviderData(target.source, 'library:liked-playlist', async () => await service.getLikedPlaylist?.() ?? null, { maxAgeMs: BROWSE_CACHE_MAX_AGE_MS }),
    ])
    if (!isShuangeFeedCurrent(target)) return
    let likedTracks: Track[] = []
    if (liked.status === 'fulfilled' && liked.value) {
      try {
        const id = liked.value.id
        likedTracks = (await requestProviderData(target.source, `shuange:playlist:${String(id)}`,
          () => service.getPlaylistSkeleton(id), { maxAgeMs: BROWSE_CACHE_MAX_AGE_MS })).tracks
      } catch { /* 口味导入失败不阻塞起播 */ }
    }
    if (isShuangeFeedCurrent(target)) seedShuangeTaste(target.source, ranking.status === 'fulfilled' ? ranking.value : [], likedTracks)
  })().finally(() => {
    if (target.taste === task) target.taste = null
  })
  target.taste = task
  return task
}
