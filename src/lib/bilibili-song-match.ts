import type { Track } from '../types/domain'
import { bilibiliSongReadings, type TitleReading } from './bilibili-title'
import { normalizeMatchText } from './match-text'
import { scoreTrackMatch, TRACK_MATCH_THRESHOLD, type TrackMatchResult } from './track-match'

function originalTitle(video: Track): string {
  return typeof video.videoTitle === 'string' && video.videoTitle.trim() ? video.videoTitle : video.name
}

function readingsOf(video: Track): TitleReading[] {
  if (typeof video.bilibiliLyricVersionTitle === 'string') {
    return [{ name: video.name, artists: video.artists?.map(artist => artist.name).filter(Boolean) ?? [] }]
  }
  return bilibiliSongReadings(originalTitle(video), video.bilibiliLyricHint)
}

function isrcOf(track: Track): string {
  return String(track.isrc ?? track.ISRC ?? '').trim().toUpperCase()
}

function artistKey(track: Track): string {
  return (track.artists?.length ? track.artists.map(artist => artist.name) : [track.artist])
    .map(normalizeMatchText).filter(Boolean).sort().join('|')
}

function sameRecording(a: Track, b: Track): boolean {
  if (normalizeMatchText(a.name) !== normalizeMatchText(b.name) || artistKey(a) !== artistKey(b)) return false
  if (isrcOf(a) && isrcOf(b) && isrcOf(a) !== isrcOf(b)) return false
  return Math.abs(Number(a.duration) - Number(b.duration)) <= 1500
}

/** 同一视频的读法共用查询预算；多读法用正反组合词，避免每种读法各跑三级搜索。 */
export function bilibiliMatchQueries(video: Track): string[] {
  const readings = readingsOf(video)
  if (!readings.length) return []
  const combined = readings.map(reading => [reading.name, ...reading.artists].join(' ').replace(/\s+/g, ' ').trim())
  const queries = readings.length > 1 ? combined : [...combined, readings[0].name]
  return [...new Set(queries.filter(Boolean))].slice(0, 2)
}

/** 缓存只跟视频身份和核验信息走，不因封面、展示读法或临时音频 URL 变化而失效。 */
export function bilibiliIdentityKey(video: Track): string {
  return JSON.stringify([
    String(video.bvid ?? video.id), originalTitle(video), video.duration ?? null,
    video.bilibiliLyricHint ?? null, isrcOf(video), video.lyricSearchVersionTitle ?? null,
  ])
}

/** 保留音频与视频身份，仅将已核验的曲库身份用于后续跨平台匹配。 */
export function bilibiliCanonicalTrack(video: Track, matched: Track): Track {
  const artists = matched.artists.length ? matched.artists : [{ id: null, name: matched.artist }]
  return {
    ...video,
    videoTitle: originalTitle(video),
    bilibiliLyricVersionTitle: originalTitle(video),
    name: matched.name,
    artist: matched.artist,
    artists: artists.map(artist => ({ ...artist, id: null })),
    bilibiliLyricHint: { name: matched.name, artists: artists.map(artist => artist.name) },
    album: matched.album,
    isrc: matched.isrc ?? matched.ISRC,
    ISRC: matched.isrc ?? matched.ISRC,
  }
}

/**
 * 先核验视频标题的所有读法，再比较不同录音；同录音的重复发行不会制造歧义。
 * 缺少歌手时只接受精确标题、1.5 秒内时长且候选歌手唯一的结果，UP 主不参与歌手评分。
 */
export function selectBilibiliSongMatch(video: Track, candidates: Track[]): TrackMatchResult | null {
  if (video.source !== 'bilibili' || !Number.isFinite(video.duration) || !(video.duration! > 0)) return null
  const readings = readingsOf(video)
  const ranked: TrackMatchResult[] = []
  const seen = new Set<string>()
  for (const candidate of candidates) {
    if (candidate.source === 'bilibili' || candidate.source === 'local'
      || !Number.isFinite(candidate.duration) || !(candidate.duration! > 0) || !artistKey(candidate)) continue
    if (isrcOf(video) && isrcOf(candidate) && isrcOf(video) !== isrcOf(candidate)) continue
    const key = `${candidate.source}:${String(candidate.mid ?? candidate.id)}`
    if (seen.has(key)) continue
    seen.add(key)
    let bestScore = 0
    for (const reading of readings) {
      const knownArtist = reading.artists.length > 0
      if (!knownArtist && (normalizeMatchText(reading.name) !== normalizeMatchText(candidate.name)
        || Math.abs(video.duration! - candidate.duration!) > 1500)) continue
      const identity: Track = {
        ...video, name: reading.name,
        artist: knownArtist ? reading.artists.join(' / ') : candidate.artist,
        artists: knownArtist ? reading.artists.map(name => ({ id: null, name })) : candidate.artists,
        bilibiliLyricVersionTitle: originalTitle(video),
      }
      const score = scoreTrackMatch(identity, candidate)
      if (score !== null && score >= TRACK_MATCH_THRESHOLD) bestScore = Math.max(bestScore, knownArtist ? score : Math.min(score, 90))
    }
    if (bestScore) ranked.push({ track: candidate, score: bestScore })
  }
  ranked.sort((a, b) => b.score - a.score)
  const [best] = ranked
  if (!best) return null
  // 只知道歌名时，不用轻微时长差替用户猜演唱者。
  if (readings.every(reading => !reading.artists.length) && new Set(ranked.map(item => artistKey(item.track))).size > 1) return null
  const competitor = ranked.find(item => !sameRecording(best.track, item.track))
  if (competitor && best.score - competitor.score < 5) return null
  const alternates = ranked.filter(item => item !== best && sameRecording(best.track, item.track)).slice(0, 2)
  return alternates.length ? { ...best, alternates } : best
}
