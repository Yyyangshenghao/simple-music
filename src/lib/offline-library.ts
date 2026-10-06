import type { Track } from '../types/domain'
import { api } from './api'

export interface OfflineLibraryItem {
  origin: {
    source: 'netease' | 'qq'
    id: string
    name?: string
    artist?: string
    album?: string
    cover?: string
    duration?: number
  }
  entryId: string
  savedAt: number
  size: number
  quality: string
}

export type OfflineLibrarySort = 'savedAt' | 'name' | 'artist'

export async function fetchOfflineLibrary(signal?: AbortSignal): Promise<OfflineLibraryItem[]> {
  const result = await api.get<{ items: OfflineLibraryItem[] }>('/api/audio-cache/library', undefined, { signal })
  return result.items
}

/** 顺序删除已确认的离线列表快照；取消后不再开始后续请求，部分失败不阻断其他歌曲。 */
export async function deleteOfflineLibraryItems(items: OfflineLibraryItem[], signal: AbortSignal): Promise<{
  removed: OfflineLibraryItem[]; failed: OfflineLibraryItem[]; cancelled: boolean
}> {
  const removed: OfflineLibraryItem[] = []
  const failed: OfflineLibraryItem[] = []
  const unique = new Map(items.map(item => [`${item.origin.source}:${item.origin.id}`, item]))
  for (const item of unique.values()) {
    if (signal.aborted) break
    try {
      await api.post('/api/audio-cache/delete', { entryId: item.entryId, origin: item.origin, savedAt: item.savedAt }, undefined, { signal })
      removed.push(item)
    } catch {
      if (signal.aborted) break
      failed.push(item)
    }
  }
  return { removed, failed, cancelled: signal.aborted }
}

export function offlineLibraryTrack(item: OfflineLibraryItem): Track {
  return {
    ...item.origin,
    provider: item.origin.source,
    type: 'song',
    name: item.origin.name || '未知歌曲',
    artist: item.origin.artist || '未知艺人',
    artists: [],
  }
}

export function filterOfflineLibrary(items: OfflineLibraryItem[], keyword: string, sort: OfflineLibrarySort): OfflineLibraryItem[] {
  const query = keyword.trim().toLocaleLowerCase()
  return items.filter(({ origin }) => !query || [origin.name, origin.artist, origin.album]
    .some((value) => value?.toLocaleLowerCase().includes(query)))
    .sort((a, b) => {
      const order = sort === 'savedAt'
        ? b.savedAt - a.savedAt
        : (a.origin[sort] || '').localeCompare(b.origin[sort] || '', 'zh-Hans-CN-u-co-pinyin')
      return order || `${a.origin.source}:${a.origin.id}`.localeCompare(`${b.origin.source}:${b.origin.id}`)
    })
}
