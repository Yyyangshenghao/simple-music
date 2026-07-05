// 歌单懒加载:全骨架(trackIds 全量)+ 按 100 首窗口补详情。
// 模块级缓存按 `${source}:${id}` 存,顶栏后退/前进或预览弹窗→详情页共用,不重拉。
// 竞态守卫沿用 loadSession 计数 ref 模式(参考 ExplorePage):切歌单/音源丢弃在途响应。

import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { useMusicService } from './useMusicService'
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
  const service = useMusicService()
  const key = `${playlist.source}:${String(playlist.id)}`
  const [, bump] = useReducer((c: number) => c + 1, 0)
  const [retryTick, setRetryTick] = useState(0)
  const sessionRef = useRef(0)

  if (!cache.has(key)) {
    cache.set(key, initialTracks?.length ? seededEntry(initialTracks) : emptyEntry())
  }

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
            e.loadedWindows.add(w)
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
