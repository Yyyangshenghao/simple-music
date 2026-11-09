import type { Track } from '../types/domain'
import { bilibiliSongReadings } from './bilibili-title'
import { selectBilibiliSongMatch } from './bilibili-song-match'

export function bilibiliVideoTitle(track: Track): string {
  return typeof track.videoTitle === 'string' && track.videoTitle.trim() ? track.videoTitle : track.name
}

/** 只附加曲库确认过的读法，保留投稿标题与 UP 主供播放、匹配和存档使用。 */
export function withBilibiliDisplayReading(track: Track, catalogTracks: Track[]): Track {
  if (track.source !== 'bilibili' || !catalogTracks.length) return track
  const best = selectBilibiliSongMatch(track, catalogTracks)
  return best ? { ...track, bilibiliDisplayReading: {
    name: best.track.name, artists: best.track.artists.length ? best.track.artists.map(artist => artist.name) : [best.track.artist],
  } } : track
}

export function bilibiliTrackDisplay(track?: Track | null, matched?: Track) {
  if (track?.source !== 'bilibili') return undefined
  const original = bilibiliVideoTitle(track)
  if (matched) return {
    name: matched.name,
    artist: matched.artist,
    caption: matched.name !== original ? original : undefined,
  }
  const readings = bilibiliSongReadings(original, track.bilibiliLyricHint)
  const saved = track.bilibiliDisplayReading
  const reading = readings.length === 1 ? readings[0] : readings.find(item => item.name === saved?.name
    && Array.isArray(saved.artists) && item.artists.join(' / ') === saved.artists.join(' / '))
  const inferredCover = reading !== track.bilibiliLyricHint && /翻唱|翻自|[男女]声(?:完整)?版|\bcover\b/iu.test(original)
  const artists = inferredCover ? [] : reading?.artists
    .map(artist => reading === track.bilibiliLyricHint ? artist : artist.replace(/\s*[(（](?:和声伴奏|伴奏|纯伴奏|原版伴奏)[)）]$/u, '').trim())
    .filter(artist => artist && !/^(?:循环(?:歌曲|播放)?|纯享|现场|完整版|原版|和声伴奏|伴奏|纯伴奏|原版伴奏|[男女]声)$/u.test(artist))
  const uploader = typeof track.uploader === 'string' ? track.uploader : track.artist
  return {
    name: reading?.name ?? original,
    artist: artists?.join(' / ') || (uploader ? `UP 主 · ${uploader}` : '歌手未识别'),
    caption: reading?.name && reading.name !== original ? original : undefined,
  }
}
