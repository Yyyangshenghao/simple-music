// 歌单懒加载:全骨架(trackIds 全量)+ 按 100 首窗口补详情。
// 模块级缓存按 `${source}:${id}` 存,顶栏后退/前进或预览弹窗→详情页共用,不重拉。
// 竞态守卫沿用 loadSession 计数 ref 模式(参考 ExplorePage):切歌单/音源丢弃在途响应。

import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { serviceFor } from '../lib/service-registry'
import { TRACK_WINDOW, windowIndicesFor, windowSpan, buildQueue } from '../lib/lazy-window'
import type { Playlist, Track } from '../types/domain'

interface LazyEntry {
  trackIds: unknown[]
  tracks: (Track | null)[]
  loadedWindows: Set<number>
  inflightWindows: Set<number>
  skeletonLoaded: boolean
  error: boolean
}

const cache = new Map<string, LazyEntry>()

/** 缓存歌单数上限:大歌单全量 Track 详情很占内存,超限后按 LRU 淘汰最久未访问的。 */
const MAX_CACHED_PLAYLISTS = 8

/** LRU:活跃 key 移到 Map 末位(最新),超上限时从最旧开始淘汰其他歌单。 */
function touchAndEvict(key: string): void {
  const e = cache.get(key)
  if (e) {
    cache.delete(key)
    cache.set(key, e)
  }
  for (const k of cache.keys()) {
    if (cache.size <= MAX_CACHED_PLAYLISTS) break
    if (k !== key) cache.delete(k)
  }
}

function emptyEntry(): LazyEntry {
  return { trackIds: [], tracks: [], loadedWindows: new Set(), inflightWindows: new Set(), skeletonLoaded: false, error: false }
}

/** 每日推荐/雷达等已全量在手的场景:直接落缓存,不发任何请求。 */
function seededEntry(tracks: Track[]): LazyEntry {
  const e = emptyEntry()
  e.trackIds = tracks.map((t) => t.id)
  e.tracks = [...tracks]
  for (let w = 0; w * TRACK_WINDOW < tracks.length; w++) e.loadedWindows.add(w)
  e.skeletonLoaded = true
  return e
}

/** 骨架回来后标记已被前缀详情覆盖的完整窗口。 */
function markPrefixWindows(e: LazyEntry, prefixLen: number): void {
  const fullWindows = Math.floor(prefixLen / TRACK_WINDOW)
  for (let w = 0; w < fullWindows; w++) e.loadedWindows.add(w)
  if (prefixLen >= e.trackIds.length) {
    for (let w = 0; w * TRACK_WINDOW < e.trackIds.length; w++) e.loadedWindows.add(w)
  }
}

export function useLazyPlaylist(playlist: Playlist, initialTracks?: Track[]) {
  // 必须绑定歌单自身的 source,不能用全局 activeSource:
  // 切换音源后仍留在旧歌单页/预览弹窗时,用错 service 会请求错音源接口,
  // 拿到空结果却仍按下面的逻辑落缓存,造成骨架永久占位且无法自愈。
  const service = serviceFor(playlist.source)
  const key = `${playlist.source}:${String(playlist.id)}`
  const [, bump] = useReducer((c: number) => c + 1, 0)
  const [retryTick, setRetryTick] = useState(0)
  const sessionRef = useRef(0)

  if (!cache.has(key)) {
    cache.set(key, initialTracks?.length ? seededEntry(initialTracks) : emptyEntry())
  } else if (initialTracks?.length) {
    // 每日推荐/雷达等 key 固定但内容会变(例如跨天刷新):对比首尾曲目 id 与长度判断是否过期,
    // 过期则用新 initialTracks 重新播种。seededEntry 是纯内存同步操作,幂等,在渲染阶段调用是安全的。
    const entry = cache.get(key)!
    const stale =
      entry.trackIds.length !== initialTracks.length ||
      String(entry.trackIds[0]) !== String(initialTracks[0].id) ||
      String(entry.trackIds[entry.trackIds.length - 1]) !== String(initialTracks[initialTracks.length - 1].id)
    if (stale) cache.set(key, seededEntry(initialTracks))
  }
  touchAndEvict(key)

  useEffect(() => {
    sessionRef.current += 1
    const session = sessionRef.current
    const e = cache.get(key)
    if (!e || e.skeletonLoaded || e.error) return
    service
      .getPlaylistSkeleton(playlist.id)
      .then((sk) => {
        if (sessionRef.current !== session) return
        e.trackIds = sk.trackIds
        e.tracks = sk.trackIds.map((_, i) => sk.tracks[i] ?? null)
        markPrefixWindows(e, sk.tracks.length)
        e.skeletonLoaded = true
        bump()
      })
      .catch(() => {
        if (sessionRef.current !== session) return
        e.error = true
        bump()
      })
    // playlist.id 已编码进 key;retryTick 触发重拉
  }, [key, service, retryTick]) // eslint-disable-line react-hooks/exhaustive-deps

  const ensureRange = useCallback(
    (start: number, end: number) => {
      const e = cache.get(key)
      if (!e || !e.skeletonLoaded) return
      const total = e.trackIds.length
      const session = sessionRef.current
      for (const w of windowIndicesFor(start, end, TRACK_WINDOW, total)) {
        if (e.loadedWindows.has(w) || e.inflightWindows.has(w)) continue
        e.inflightWindows.add(w)
        const span = windowSpan(w, TRACK_WINDOW, total)
        service
          .getTracksByIds(e.trackIds.slice(span.start, span.end))
          .then((fetched) => {
            e.inflightWindows.delete(w)
            const byId = new Map(fetched.map((t) => [String(t.id), t]))
            for (let i = span.start; i < span.end; i++) {
              e.tracks[i] = byId.get(String(e.trackIds[i])) ?? e.tracks[i]
            }
            // 只有真正拿到数据才标记已加载:service 绑错音源等情况会返回空数组,
            // 若仍标记 loaded,该窗口将永久停留在骨架态,滚动重试也无法触发重拉。
            if (fetched.length > 0) e.loadedWindows.add(w)
            if (sessionRef.current === session) bump()
          })
          .catch(() => {
            // 失败不标记 loaded:下次滚到该窗口自动重试
            e.inflightWindows.delete(w)
          })
      }
    },
    [key, service]
  )

  const entry = cache.get(key)!
  return {
    total: entry.trackIds.length,
    tracks: entry.tracks,
    loading: !entry.skeletonLoaded && !entry.error,
    error: entry.error,
    ensureRange,
    makeQueue: () => buildQueue(entry.trackIds, entry.tracks, playlist.source),
    retry: () => {
      entry.error = false
      setRetryTick((t) => t + 1)
    },
  }
}
