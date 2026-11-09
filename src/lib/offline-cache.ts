import type { Track } from '../types/domain'
import { api } from './api'

/** 经音频代理播放、可进播放缓存与下载的在线来源；Apple 受保护音频与本地文件不在其中。 */
export type CacheableSource = 'netease' | 'qq' | 'kugou'

export function isCacheableSource(source: unknown): source is CacheableSource {
  return source === 'netease' || source === 'qq' || source === 'kugou'
}

/** downloaded：下载目录里有这首歌的文件；cached：播放器有自动缓存（界面不单独展示）。 */
export type OfflineCacheState = 'missing' | 'cached' | 'downloaded'

export interface OfflineCacheStatus {
  source: CacheableSource
  id: string
  state: OfflineCacheState
  entryId?: string
  resolved?: { source: CacheableSource; id: string; name?: string; artist?: string }
  quality?: string
  size?: number
  savedAt?: number
}

export function offlineTrackKey(track: Pick<Track, 'source' | 'id'>): string {
  return `${track.source}:${String(track.id)}`
}

export function offlineOrigin(track: Track): Record<string, unknown> {
  return {
    source: track.source,
    id: String(track.id),
    name: track.name,
    artist: track.artist,
    album: track.album,
    cover: track.cover,
    duration: track.duration,
  }
}

export function offlineFileUrl(status: OfflineCacheStatus, track: Track): string | null {
  if (status.state === 'downloaded') return api.url('/api/downloads/file', { source: track.source, id: String(track.id) })
  if (!status.entryId || status.state === 'missing') return null
  return api.url('/api/audio-cache/file', {
    entryId: status.entryId,
    source: track.source,
    id: String(track.id),
  })
}

export async function fetchOfflineStatuses(tracks: Track[], signal?: AbortSignal): Promise<OfflineCacheStatus[]> {
  const refs = [...new Map(tracks.flatMap((track) => (
    isCacheableSource(track.source)
      ? [[offlineTrackKey(track), { source: track.source, id: String(track.id) }] as const]
      : []
  ))).values()]
  if (!refs.length) return []
  const statuses: OfflineCacheStatus[] = []
  for (let offset = 0; offset < refs.length; offset += 100) {
    const response = await api.post<{ statuses: OfflineCacheStatus[] }>(
      '/api/audio-cache/status',
      { tracks: refs.slice(offset, offset + 100) },
      undefined,
      { signal }
    )
    statuses.push(...response.statuses)
  }
  return statuses
}

export async function fetchOfflineStatus(track: Track, signal?: AbortSignal): Promise<OfflineCacheStatus> {
  const [status] = await fetchOfflineStatuses([track], signal)
  return status ?? { source: track.source as CacheableSource, id: String(track.id), state: 'missing' }
}
