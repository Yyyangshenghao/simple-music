// 歌单懒加载:全骨架(trackIds 全量)+ 按 100 首窗口补详情。
// 模块级缓存按 `${source}:${type}:${id}` 存,顶栏后退/前进或预览弹窗→详情页共用;重新进入时校验歌单内容。
// 竞态守卫沿用 loadSession 计数 ref 模式(参考 ExplorePage):切歌单/音源丢弃在途响应。

import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { serviceFor } from '../lib/service-registry'
import { TRACK_WINDOW, windowIndicesFor, windowSpan, buildQueue } from '../lib/lazy-window'
import type { Playlist, Track } from '../types/domain'
import { isProviderId } from '../providers/types'
import { isProviderParticipating, useProviderStore } from '../stores/providers'

interface LazyEntry {
  trackIds: unknown[]
  tracks: (Track | null)[]
  loadedWindows: Set<number>
  inflightWindows: Map<number, Promise<void>>
  skeletonLoaded: boolean
  error: boolean
  /** 骨架加载完成时间戳,用于 TTL 过期判断。 */
  ts: number
  /** 平台返回的曲目最近更新时间；不可用时仍用有序 trackIds 判变更。 */
  updatedAt: number | null
}

const cache = new Map<string, LazyEntry>()
const skeletonVersions = new Map<string, number>()
let nextSkeletonVersion = 0

function playlistCacheKey(playlist: Playlist): string {
  return `${playlist.source}:${playlist.type}:${String(playlist.id)}`
}

/** 缓存歌单数上限:大歌单全量 Track 详情很占内存,超限后按 LRU 淘汰最久未访问的。
 *  4 份已够覆盖「详情页↔预览弹窗↔顶栏前进后退」的往返;再多只是堆内存。 */
const MAX_CACHED_PLAYLISTS = 4

/** 缓存 TTL:骨架加载完成超过此时长的 entry 视为过期,下次访问丢弃重拉。
 *  让长时间会话内歌单的外部改动(加歌/删歌/改序)能反映,而非永久占着旧骨架。
 *  仅对骨架已加载的 entry 判断:还在加载或出错的没东西可过期。 */
const CACHE_TTL_MS = 10 * 60 * 1000

/** LRU:活跃 key 移到 Map 末位(最新),超上限时从最旧开始淘汰其他歌单。 */
function touchAndEvict(key: string): void {
  const e = cache.get(key)
  if (e) {
    cache.delete(key)
    cache.set(key, e)
  }
  for (const k of cache.keys()) {
    if (cache.size <= MAX_CACHED_PLAYLISTS) break
    if (k !== key) {
      cache.delete(k)
      skeletonVersions.delete(k)
    }
  }
}

function emptyEntry(): LazyEntry {
  return { trackIds: [], tracks: [], loadedWindows: new Set(), inflightWindows: new Map(), skeletonLoaded: false, error: false, ts: 0, updatedAt: null }
}

/** 每日推荐/雷达等已全量在手的场景:直接落缓存,不发任何请求。 */
function seededEntry(tracks: Track[]): LazyEntry {
  const e = emptyEntry()
  e.trackIds = tracks.map((t) => t.id)
  e.tracks = [...tracks]
  for (let w = 0; w * TRACK_WINDOW < tracks.length; w++) e.loadedWindows.add(w)
  e.skeletonLoaded = true
  e.ts = Date.now()
  return e
}

/** 访问前清理过期 entry(TTL)。 */
function evictIfStale(key: string): void {
  const e = cache.get(key)
  if (e && e.skeletonLoaded && Date.now() - e.ts > CACHE_TTL_MS) {
    cache.delete(key)
    skeletonVersions.delete(key)
  }
}

/**
 * 把前缀详情批次按 id 对齐到 trackIds 顺序。
 * song_detail 会跳过下架/缺失曲目,按下标对齐(tracks[i])会让缺歌之后的整段错位一行、
 * 展示成别的曲目;按 id 对齐则缺失处留 null(渲染成占位行),与 ensureRange 的窗口补详情一致。
 */
function alignTracksByIds(trackIds: unknown[], details: Track[]): (Track | null)[] {
  if (details.length === 0) return trackIds.map(() => null)
  const byId = new Map(details.map((t) => [String(t.id), t]))
  return trackIds.map((id) => byId.get(String(id)) ?? null)
}

/** 骨架回来后标记已被前缀详情覆盖的完整窗口。 */
function markPrefixWindows(e: LazyEntry, prefixLen: number): void {
  const fullWindows = Math.floor(prefixLen / TRACK_WINDOW)
  for (let w = 0; w < fullWindows; w++) e.loadedWindows.add(w)
  if (prefixLen >= e.trackIds.length) {
    for (let w = 0; w * TRACK_WINDOW < e.trackIds.length; w++) e.loadedWindows.add(w)
  }
}

/**
 * 命令式取整份播放队列:给「不进详情页、点一下直接播」的入口用(探索页快捷入口)。
 * 与 useLazyPlaylist 共用同一份模块级缓存,同一歌单不会重复拉骨架;失败由调用方 catch。
 */
export async function loadPlaylistQueue(playlist: Playlist): Promise<Track[]> {
  if (isProviderId(playlist.source) && !isProviderParticipating(playlist.source)) {
    throw new Error('该平台未登录或未启用')
  }
  // 同样必须绑定歌单自身的 source，不能用其他平台的 service。
  const service = serviceFor(playlist.source)
  const key = playlistCacheKey(playlist)
  evictIfStale(key)
  let entry = cache.get(key)
  if (!entry) {
    entry = emptyEntry()
    cache.set(key, entry)
  }
  touchAndEvict(key)
  if (!entry.skeletonLoaded) {
    if (playlist.type === 'album') {
      entry = seededEntry(await service.getAlbumTracks(playlist.id))
      cache.set(key, entry)
    } else {
      const sk = await service.getPlaylistSkeleton(playlist.id)
      entry.trackIds = sk.trackIds
      entry.tracks = alignTracksByIds(sk.trackIds, sk.tracks)
      markPrefixWindows(entry, sk.tracks.length)
      entry.skeletonLoaded = true
      entry.ts = Date.now()
      entry.updatedAt = sk.updatedAt ?? null
    }
  }
  return buildQueue(entry.trackIds, entry.tracks, playlist.source)
}

/** 追加歌曲后下次打开详情重新读取骨架。 */
export function invalidatePlaylistCache(playlist: Playlist): void {
  const key = playlistCacheKey(playlist)
  cache.delete(key)
  skeletonVersions.delete(key)
}

export function useLazyPlaylist(playlist: Playlist, initialTracks?: Track[]) {
  // 必须绑定歌单自身的 source：
  // 切换音源后仍留在旧歌单页/预览弹窗时,用错 service 会请求错音源接口,
  // 拿到空结果却仍按下面的逻辑落缓存,造成骨架永久占位且无法自愈。
  const service = serviceFor(playlist.source)
  const available = useProviderStore((state) =>
    !isProviderId(playlist.source)
      || (state.byId[playlist.source].enabled && state.byId[playlist.source].auth === 'authenticated')
  )
  const key = playlistCacheKey(playlist)
  const [, bump] = useReducer((c: number) => c + 1, 0)
  const [retryTick, setRetryTick] = useState(0)
  const sessionRef = useRef(0)

  evictIfStale(key)
  if (!cache.has(key)) {
    cache.set(key, initialTracks?.length ? seededEntry(initialTracks) : emptyEntry())
  } else if (initialTracks?.length) {
    // 每日推荐/雷达等 key 固定但内容会变:按不可变曲目对象及顺序比较,同时感知换歌和资料更新。
    // 对象与顺序未变时复用缓存,即使调用方复制了数组也无需重新播种。
    const entry = cache.get(key)!
    const stale =
      entry.trackIds.length !== initialTracks.length ||
      initialTracks.some((track, index) => entry.tracks[index] !== track)
    if (stale) cache.set(key, seededEntry(initialTracks))
  }
  touchAndEvict(key)

  const refresh = useCallback(async () => {
    if (!available || playlist.type === 'album' || initialTracks?.length) return
    let previous = cache.get(key)
    if (!previous) {
      previous = emptyEntry()
      cache.set(key, previous)
      touchAndEvict(key)
    }
    const session = ++sessionRef.current
    const version = ++nextSkeletonVersion
    skeletonVersions.set(key, version)
    try {
      const sk = await service.getPlaylistSkeleton(playlist.id)
      if (sessionRef.current !== session || skeletonVersions.get(key) !== version || cache.get(key) !== previous) return
      const next = emptyEntry()
      next.trackIds = sk.trackIds
      next.tracks = alignTracksByIds(sk.trackIds, sk.tracks)
      markPrefixWindows(next, sk.tracks.length)
      next.skeletonLoaded = true
      next.ts = Date.now()
      next.updatedAt = sk.updatedAt ?? null
      cache.set(key, next)
      bump()
    } catch (error) {
      if (sessionRef.current === session && skeletonVersions.get(key) === version && cache.get(key) === previous && !previous.skeletonLoaded) {
        previous.error = true
        bump()
      }
      throw error
    }
  }, [available, key, playlist.id, playlist.type, initialTracks, service])

  const checkForUpdates = useCallback(async () => {
    if (!available || playlist.type === 'album' || initialTracks?.length) return
    const current = cache.get(key)
    if (!current?.skeletonLoaded || !service.getPlaylistRevision) {
      await refresh()
      return
    }
    const session = sessionRef.current
    const revision = await service.getPlaylistRevision(playlist.id)
    if (sessionRef.current !== session || cache.get(key) !== current) return
    const timeChanged = current.updatedAt !== null && revision.updatedAt !== null && current.updatedAt !== revision.updatedAt
    const idsChanged = current.trackIds.length !== revision.trackIds.length
      || current.trackIds.some((id, index) => String(id) !== String(revision.trackIds[index]))
    if (timeChanged || idsChanged) await refresh()
    else {
      current.updatedAt = revision.updatedAt ?? current.updatedAt
      current.ts = Date.now()
    }
  }, [available, key, playlist.id, playlist.type, initialTracks, refresh, service])

  useEffect(() => {
    sessionRef.current += 1
    const session = sessionRef.current
    const e = cache.get(key)
    if (!available || !e) return
    if (e.error) {
      e.error = false
      bump()
    }
    // 专辑没有歌单骨架接口:一次拉全量曲目直接播种(专辑规模小,无需窗口懒加载)
    if (playlist.type === 'album') {
      if (e.skeletonLoaded) return
      service
        .getAlbumTracks(playlist.id)
        .then((tracks) => {
          if (sessionRef.current !== session) return
          cache.set(key, seededEntry(tracks))
          bump()
        })
        .catch(() => {
          if (sessionRef.current !== session) return
          e.error = true
          bump()
        })
      return () => { sessionRef.current += 1 }
    }
    void (e.skeletonLoaded ? checkForUpdates() : refresh()).catch(() => {})
    return () => { sessionRef.current += 1 }
    // playlist.id 已编码进 key;retryTick 触发重拉
  }, [available, key, service, retryTick]) // eslint-disable-line react-hooks/exhaustive-deps

  const entry = cache.get(key)!

  const loadWindow = useCallback((e: LazyEntry, w: number): Promise<void> => {
    if (e.loadedWindows.has(w)) return Promise.resolve()
    const inflight = e.inflightWindows.get(w)
    if (inflight) return inflight
    const session = sessionRef.current
    const span = windowSpan(w, TRACK_WINDOW, e.trackIds.length)
    const request = service.getTracksByIds(e.trackIds.slice(span.start, span.end))
      .then((fetched) => {
        const byId = new Map(fetched.map((t) => [String(t.id), t]))
        for (let i = span.start; i < span.end; i++) {
          e.tracks[i] = byId.get(String(e.trackIds[i])) ?? e.tracks[i]
        }
        if (fetched.length > 0) e.loadedWindows.add(w)
        else throw new Error('歌曲详情暂不可用')
        if (sessionRef.current === session) bump()
      })
      .finally(() => { e.inflightWindows.delete(w) })
    e.inflightWindows.set(w, request)
    return request
  }, [service])

  const ensureRange = useCallback((start: number, end: number) => {
    if (!available) return
    const e = cache.get(key)
    if (!e?.skeletonLoaded) return
    for (const w of windowIndicesFor(start, end, TRACK_WINDOW, e.trackIds.length)) {
      void loadWindow(e, w).catch(() => {})
    }
  }, [available, key, loadWindow, entry])

  const ensureAll = useCallback(async (cancelled: () => boolean) => {
    if (!available) return
    const e = cache.get(key)
    if (!e?.skeletonLoaded) return
    // 串行补齐，复用可见区域的在途请求，避免大歌单同时发出大量请求。
    for (const w of windowIndicesFor(0, e.trackIds.length, TRACK_WINDOW, e.trackIds.length)) {
      if (cancelled()) return
      await loadWindow(e, w)
    }
  }, [available, key, loadWindow, entry])

  return {
    total: entry.trackIds.length,
    tracks: entry.tracks,
    loading: !entry.skeletonLoaded && !entry.error,
    error: entry.error || !available,
    available,
    ensureRange,
    ensureAll,
    makeQueue: () => {
      const current = cache.get(key) ?? entry
      return buildQueue(current.trackIds, current.tracks, playlist.source)
    },
    refresh,
    checkForUpdates,
    canCheckForUpdates: !!service.getPlaylistRevision,
    retry: () => {
      entry.error = false
      setRetryTick((t) => t + 1)
    },
  }
}
