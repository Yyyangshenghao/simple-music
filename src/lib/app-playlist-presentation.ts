import type { MusicSource, Track } from '../types/domain'
import { normalizeImageUrl } from './image-size'
import { restoreLocalTrackUrls } from './local-track-urls'

const SOURCES: MusicSource[] = ['netease', 'qq', 'apple', 'local']

export function appPlaylistSources(tracks: Track[]): { source: MusicSource; count: number }[] {
  const counts = new Map<MusicSource, number>()
  for (const track of tracks) counts.set(track.source, (counts.get(track.source) ?? 0) + 1)
  return SOURCES.flatMap(source => {
    const count = counts.get(source) ?? 0
    return count ? [{ source, count }] : []
  })
}

export function appPlaylistCovers(tracks: Track[]): { source: MusicSource; url: string }[] {
  const candidates = tracks.flatMap(track => {
    const url = track.source === 'local'
      ? restoreLocalTrackUrls(track).cover
      : normalizeImageUrl(track.cover)
    return url ? [{ source: track.source, url }] : []
  })
  const covers: { source: MusicSource; url: string }[] = []
  const used = new Set<string>()
  for (const source of SOURCES) {
    const cover = candidates.find(candidate => candidate.source === source && !used.has(candidate.url))
    if (cover) { covers.push(cover); used.add(cover.url) }
  }
  for (const candidate of candidates) {
    if (covers.length >= 4) break
    if (!used.has(candidate.url)) { covers.push(candidate); used.add(candidate.url) }
  }
  return covers
}
