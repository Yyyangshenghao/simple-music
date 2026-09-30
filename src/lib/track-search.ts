import type { Track } from '../types/domain'

/** 保留原列表下标，筛选后仍能定位完整播放队列。 */
export function matchingTrackIndices(tracks: readonly (Track | null)[], query: string, includeArtists = false): number[] {
  const keyword = query.trim().toLocaleLowerCase()
  return tracks.flatMap((track, index) => {
    if (!track || track.pending) return []
    const fields = includeArtists ? [track.name, track.artist, ...track.artists.map((artist) => artist.name)] : [track.name]
    return !keyword || fields.some((field) => field.toLocaleLowerCase().includes(keyword)) ? [index] : []
  })
}
