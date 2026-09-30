import type { Track } from '../types/domain'
import { api } from './api'

export type OfflineCacheState = 'missing' | 'cached' | 'pinned'

export interface OfflineCacheStatus {
  source: 'netease' | 'qq'
  id: string
  state: OfflineCacheState
  entryId?: string
  resolved?: { source: 'netease' | 'qq'; id: string; name?: string; artist?: string }
  quality?: string
  size?: number
  savedAliasCount?: number
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
  if (!status.entryId || status.state === 'missing') return null
  return api.url('/api/audio-cache/file', {
    entryId: status.entryId,
    source: track.source,
    id: String(track.id),
  })
}

export async function fetchOfflineStatuses(tracks: Track[], signal?: AbortSignal): Promise<OfflineCacheStatus[]> {
  const refs = [...new Map(tracks.flatMap((track) => (
    track.source === 'netease' || track.source === 'qq'
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
  return status ?? { source: track.source as 'netease' | 'qq', id: String(track.id), state: 'missing' }
}
