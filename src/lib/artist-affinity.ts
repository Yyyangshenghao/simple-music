import type { Track } from '../types/domain'

export interface ArtistCount {
  id: unknown
  name: string
  count: number
}

/** 按出现次数统计多批曲目里的歌手（红心歌单 + 听歌排行等），按 id 去重合并计数，降序取前 limit 个。 */
export function rankArtistsByFrequency(trackLists: Track[][], limit = 12): ArtistCount[] {
  const counts = new Map<string, ArtistCount>()
  for (const tracks of trackLists) {
    for (const track of tracks) {
      for (const artist of track.artists ?? []) {
        if (artist.id === undefined || artist.id === null || !artist.name) continue
        const key = String(artist.id)
        const existing = counts.get(key)
        if (existing) existing.count += 1
        else counts.set(key, { id: artist.id, name: artist.name, count: 1 })
      }
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count).slice(0, limit)
}
