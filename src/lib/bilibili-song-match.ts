import type { Track } from '../types/domain'
import { bilibiliSongReadings, bilibiliTitleText, type TitleReading } from './bilibili-title'
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

/** 先试组合词，再独立探测可能的歌名；每个平台最多四次查询。 */
export function bilibiliMatchQueries(video: Track): string[] {
  const readings = readingsOf(video)
  if (!readings.length) return []
  const combined = readings.map(reading => [reading.name, ...reading.artists].join(' ').replace(/\s+/g, ' ').trim())
  return [...new Set([...combined.slice(0, 2), ...readings.map(reading => reading.name)].filter(Boolean))].slice(0, 4)
}

/** 缓存只跟视频身份和核验信息走，不因封面、展示读法或临时音频 URL 变化而失效。 */
export function bilibiliIdentityKey(video: Track): string {
  return JSON.stringify([
    2, String(video.bvid ?? video.id), originalTitle(video), video.duration ?? null,
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
    bilibiliRecordingDuration: matched.duration,
  }
}

/** 用候选反查标题中的歌名、歌手，避免把宣传尾句当作艺人；UP 主仍不参与。 */
function candidateReadings(video: Track, candidate: Track, manual: boolean): TitleReading[] {
  const readings = readingsOf(video)
  if (video.bilibiliLyricHint || typeof video.bilibiliLyricVersionTitle === 'string') return readings
  const rawTitle = bilibiliTitleText(originalTitle(video)).normalize('NFKC')
  const title = normalizeMatchText(rawTitle)
  const name = normalizeMatchText(candidate.name)
  const artists = candidate.artists?.length ? candidate.artists.map(artist => artist.name) : [candidate.artist]
  // 短名不能靠字符串包含来扩大自动识别；已有精确读法仍按原规则核验。
  if ([...name].length < 2 || !title.includes(name)) return readings
  const exactReading = readings.some(reading => normalizeMatchText(reading.name) === name)
  if (/《[^》]+》|「[^」]+」|『[^』]+』/u.test(rawTitle) && !exactReading) return readings
  if (!manual && !exactReading) return readings
  const known = artists.filter(artist => {
    const value = normalizeMatchText(artist)
    const escaped = artist.normalize('NFKC').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return [...value].length >= 2 && value !== name
      && new RegExp(`(?:^|[^\\p{L}\\p{N}'’._-])${escaped}(?=$|[^\\p{L}\\p{N}'’._-])`, 'iu').test(rawTitle)
  })
  if (known.length) return [...readings, { name: candidate.name, artists: known }]
  return manual ? [...readings, { name: candidate.name, artists: [] }] : readings
}

function rank(video: Track, candidates: Track[], manual: boolean): TrackMatchResult[] {
  const duration = typeof video.bilibiliRecordingDuration === 'number' ? video.bilibiliRecordingDuration : video.duration
  if (video.source !== 'bilibili' || !Number.isFinite(duration) || !(duration! > 0)) return []
  const ranked: TrackMatchResult[] = []
  const seen = new Set<string>()
  for (const candidate of candidates) {
    if (candidate.source === 'bilibili' || candidate.source === 'local'
      || !Number.isFinite(candidate.duration) || !(candidate.duration! > 0) || !artistKey(candidate)) continue
    if (isrcOf(video) && isrcOf(candidate) && isrcOf(video) !== isrcOf(candidate)) continue
    const key = `${candidate.source}:${String(candidate.mid ?? candidate.id)}`
    if (seen.has(key)) continue
    seen.add(key)
    const diff = Math.abs(duration! - candidate.duration!)
    // 人工候选允许短片头片尾；长剪辑、合集不靠标题猜单曲。
    if (diff > (manual ? Math.min(30_000, duration! * 0.1) : 3000)) continue
    let bestScore = 0
    const strictReadings = candidateReadings(video, candidate, false)
    for (const reading of candidateReadings(video, candidate, manual)) {
      const knownArtist = reading.artists.length > 0
      if (!knownArtist && (normalizeMatchText(reading.name) !== normalizeMatchText(candidate.name)
        || (!manual && diff > 1500))) continue
      const identity: Track = {
        ...video, name: reading.name,
        duration: manual && diff > 3000 ? candidate.duration : duration,
        artist: knownArtist ? reading.artists.join(' / ') : candidate.artist,
        artists: knownArtist ? reading.artists.map(name => ({ id: null, name })) : candidate.artists,
        bilibiliLyricVersionTitle: originalTitle(video),
      }
      const score = scoreTrackMatch(identity, candidate)
      if (score === null || score < TRACK_MATCH_THRESHOLD) continue
      const inferred = !strictReadings.some(item => item.name === reading.name && item.artists.join('|') === reading.artists.join('|'))
      const cap = diff > 3000 ? Math.max(60, 79 - Math.floor((diff - 3000) / 2000)) : inferred ? 79 : knownArtist ? 100 : 90
      bestScore = Math.max(bestScore, Math.min(score, cap))
    }
    if (bestScore) ranked.push({ track: candidate, score: bestScore })
  }
  return ranked.sort((a, b) => b.score - a.score || Number(!!b.track.cover) - Number(!!a.track.cover))
}

/** 供人工确认的候选；同录音重复发行与跨平台副本合并，不挤占前三首。 */
export function rankBilibiliSongCandidates(video: Track, candidates: Track[]): TrackMatchResult[] {
  const distinct: TrackMatchResult[] = []
  for (const item of rank(video, candidates, true)) {
    if (!distinct.some(other => sameRecording(other.track, item.track))) distinct.push(item)
    if (distinct.length === 3) break
  }
  return distinct
}

/** 高置信度才自动关联；同名异歌手、正反读法与接近的竞争录音留给用户确认。 */
export function selectBilibiliSongMatch(video: Track, candidates: Track[]): TrackMatchResult | null {
  const ranked = rank(video, candidates, false)
  const [best] = ranked
  if (!best) return null
  if (readingsOf(video).every(reading => !reading.artists.length) && new Set(ranked.map(item => artistKey(item.track))).size > 1) return null
  const competitor = ranked.find(item => !sameRecording(best.track, item.track))
  if (competitor && best.score - competitor.score < 5) return null
  const alternates = ranked.filter(item => item !== best && sameRecording(best.track, item.track)).slice(0, 2)
  return alternates.length ? { ...best, alternates } : best
}
