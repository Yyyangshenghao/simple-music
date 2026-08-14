import { providerFor } from '../providers/registry'
import type { ProviderId } from '../providers/types'
import type { Track } from '../types/domain'

export const TRACK_MATCH_SCHEMA = 2
export const TRACK_MATCH_THRESHOLD = 80

const MATCH_CACHE_KEY = 'simplemusic-track-match-cache'
const POSITIVE_TTL_MS = 30 * 24 * 60 * 60 * 1000
const NEGATIVE_TTL_MS = 24 * 60 * 60 * 1000

type VersionTag = 'live' | 'instrumental' | 'remix' | 'cover' | 'remaster' | 'acoustic' | 'demo'

interface MatchCacheEntry {
  targetId?: unknown
  /** QQ legacy 服务不支持按 id 补单曲详情，缓存去掉临时 URL 的完整匹配快照。 */
  targetTrack?: Track
  score?: number
  verifiedAt: number
  expiresAt: number
}

interface MatchCacheArchive {
  schema: typeof TRACK_MATCH_SCHEMA
  entries: Record<string, MatchCacheEntry>
}

export interface TrackMatchResult {
  track: Track
  score: number
}

const VERSION_PATTERNS: Array<[VersionTag, RegExp]> = [
  ['live', /\blive\b|现场/giu],
  ['instrumental', /\binstrumental\b|\bkaraoke\b|伴奏/giu],
  ['remix', /\bremix\b|\bmix\b/giu],
  ['cover', /\bcover\b|翻唱/giu],
  ['remaster', /\bremaster(?:ed)?\b|重制/giu],
  ['acoustic', /\bacoustic\b|不插电/giu],
  ['demo', /\bdemo\b/giu],
]

function normalizeBrackets(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[（【［]/g, '(')
    .replace(/[）】］]/g, ')')
}

/** 同曲匹配用文本归一化：兼容宽字符、大小写、标点和空白差异。 */
export function normalizeMatchText(value: string): string {
  return normalizeBrackets(value)
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, '')
}

function versionTagsOf(track: Track): Set<VersionTag> {
  const value = normalizeBrackets(`${track.name ?? ''} ${track.album ?? ''}`).toLocaleLowerCase()
  const tags = new Set<VersionTag>()
  for (const [tag, pattern] of VERSION_PATTERNS) {
    pattern.lastIndex = 0
    if (pattern.test(value)) tags.add(tag)
  }
  return tags
}

function sameSet<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false
  for (const value of a) if (!b.has(value)) return false
  return true
}

function baseTitleOf(track: Track): string {
  let value = normalizeBrackets(track.name ?? '').toLocaleLowerCase()
  value = value.replace(/\([^)]*\)|\[[^\]]*\]/gu, (segment) => {
    return VERSION_PATTERNS.some(([, pattern]) => {
      pattern.lastIndex = 0
      return pattern.test(segment)
    }) ? '' : segment
  })
  for (const [, pattern] of VERSION_PATTERNS) {
    pattern.lastIndex = 0
    value = value.replace(pattern, '')
  }
  return normalizeMatchText(value)
}

/** 平台常在艺人主名后附加别名括注；匹配时优先使用括注外的主名。 */
function normalizeArtistMatchText(value: string): string {
  const normalized = normalizeMatchText(value)
  const primary = normalizeMatchText(
    normalizeBrackets(value).replace(/\s*(?:\([^)]*\)|\[[^\]]*\])\s*$/u, '')
  )
  return primary || normalized
}

function artistNamesOf(track: Track): string[] {
  const names = (track.artists ?? []).map((artist) => artist.name).filter(Boolean)
  const raw = names.length > 0 ? names : [track.artist ?? '']
  return raw
    .flatMap((name) => name.split(/\s+(?:feat\.?|ft\.?)\s+|[/、,，&]/giu))
    .map(normalizeArtistMatchText)
    .filter(Boolean)
}

function isrcOf(track: Track): string {
  return String(track.isrc ?? track.ISRC ?? '').trim().toUpperCase()
}

/** 保守的同曲评分；返回 null 表示存在硬冲突，禁止自动匹配。 */
export function scoreTrackMatch(origin: Track, candidate: Track): number | null {
  const originTitle = normalizeMatchText(origin.name ?? '')
  const candidateTitle = normalizeMatchText(candidate.name ?? '')
  const originBase = baseTitleOf(origin)
  const candidateBase = baseTitleOf(candidate)
  if (!originTitle || !candidateTitle || !originBase || originBase !== candidateBase) return null
  if (!sameSet(versionTagsOf(origin), versionTagsOf(candidate))) return null

  const originArtists = artistNamesOf(origin)
  const candidateArtists = artistNamesOf(candidate)
  const candidateArtistSet = new Set(candidateArtists)
  const artistOverlap = originArtists.filter((artist) => candidateArtistSet.has(artist))
  if (artistOverlap.length === 0) return null

  const originDuration = Number(origin.duration ?? 0)
  const candidateDuration = Number(candidate.duration ?? 0)
  const hasDurations = originDuration > 0 && candidateDuration > 0
  const durationDiff = hasDurations ? Math.abs(originDuration - candidateDuration) : null
  if (durationDiff != null && durationDiff > 3000) return null

  const originIsrc = isrcOf(origin)
  const candidateIsrc = isrcOf(candidate)
  if (originIsrc && candidateIsrc && originIsrc === candidateIsrc) return 100

  let score = originTitle === candidateTitle ? 55 : 40
  score += 25
  if (artistOverlap.length > 1) score += 5
  if (durationDiff != null) score += durationDiff <= 1000 ? 15 : 8
  if (
    origin.album &&
    candidate.album &&
    normalizeMatchText(origin.album) === normalizeMatchText(candidate.album)
  ) score += 5
  return Math.min(100, score)
}

export function matchBestTrack(origin: Track, candidates: Track[]): TrackMatchResult | null {
  let best: TrackMatchResult | null = null
  for (const candidate of candidates) {
    const score = scoreTrackMatch(origin, candidate)
    if (score == null || score < TRACK_MATCH_THRESHOLD) continue
    if (!best || score > best.score) best = { track: candidate, score }
  }
  return best
}

function emptyArchive(): MatchCacheArchive {
  return { schema: TRACK_MATCH_SCHEMA, entries: {} }
}

function readArchive(): MatchCacheArchive {
  if (typeof localStorage === 'undefined') return emptyArchive()
  try {
    const parsed = JSON.parse(localStorage.getItem(MATCH_CACHE_KEY) ?? '') as Partial<MatchCacheArchive>
    if (parsed.schema !== TRACK_MATCH_SCHEMA || !parsed.entries || typeof parsed.entries !== 'object') {
      return emptyArchive()
    }
    return { schema: TRACK_MATCH_SCHEMA, entries: parsed.entries }
  } catch {
    return emptyArchive()
  }
}

function writeArchive(archive: MatchCacheArchive): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(MATCH_CACHE_KEY, JSON.stringify(archive))
  } catch {
    /* 匹配缓存失败只影响下次搜索耗时。 */
  }
}

function originKey(track: Track, targetSource: ProviderId): string {
  return `${track.source}:${String(track.mid ?? track.id ?? '')}->${targetSource}`
}

function cacheableTrack(track: Track): Track {
  const { url: _url, pending: _pending, ...rest } = track
  return rest as Track
}

function abortError(): Error {
  return new DOMException('Playback match cancelled', 'AbortError')
}

/** 搜索并缓存目标平台的可靠同曲；负缓存 24 小时，自动命中缓存 30 天。 */
export async function findEquivalentTrack(
  origin: Track,
  targetSource: ProviderId,
  signal?: AbortSignal,
  now = Date.now()
): Promise<TrackMatchResult | null> {
  if (signal?.aborted) throw abortError()
  const archive = readArchive()
  const key = originKey(origin, targetSource)
  const cached = archive.entries[key]
  const provider = providerFor(targetSource)
  if (cached && cached.expiresAt > now) {
    if (cached.targetId == null) return null
    if (cached.targetTrack?.source === targetSource) {
      return { track: cached.targetTrack, score: cached.score ?? TRACK_MATCH_THRESHOLD }
    }
    const tracks = await provider.catalog.getTracksByIds([cached.targetId])
    if (signal?.aborted) throw abortError()
    const track = tracks[0]
    if (track) return { track, score: cached.score ?? TRACK_MATCH_THRESHOLD }
    delete archive.entries[key]
    writeArchive(archive)
  }

  const keyword = `${origin.name ?? ''} ${origin.artist ?? ''}`.trim()
  if (!keyword) return null
  const candidates = await provider.catalog.searchTracks(keyword)
  if (signal?.aborted) throw abortError()
  const result = matchBestTrack(origin, candidates)
  archive.entries[key] = result
    ? {
        targetId: result.track.id,
        targetTrack: cacheableTrack(result.track),
        score: result.score,
        verifiedAt: now,
        expiresAt: now + POSITIVE_TTL_MS,
      }
    : { verifiedAt: now, expiresAt: now + NEGATIVE_TTL_MS }
  writeArchive(archive)
  return result
}

export function clearTrackMatchCache(): void {
  if (typeof localStorage === 'undefined') return
  localStorage.removeItem(MATCH_CACHE_KEY)
}
