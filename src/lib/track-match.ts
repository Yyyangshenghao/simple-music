import { providerFor } from '../providers/registry'
import type { ProviderId } from '../providers/types'
import type { Track } from '../types/domain'
import { searchGuestTracks } from './lyric-service'
import { normalizeBrackets, normalizeMatchText } from './match-text'

export { normalizeMatchText }

export const TRACK_MATCH_SCHEMA = 3
export const TRACK_MATCH_THRESHOLD = 80

const MATCH_CACHE_KEY = 'simplemusic-track-match-cache'
const POSITIVE_TTL_MS = 30 * 24 * 60 * 60 * 1000
const NEGATIVE_TTL_MS = 24 * 60 * 60 * 1000
/** 缺少时长时的最高分：无法排除不同录音。 */
const NO_DURATION_MAX_SCORE = 85
/** 最佳候选之外保留的后备候选数：最佳候选取不到可用歌词时依次尝试。 */
const MAX_ALTERNATES = 2

interface ScoredTrack {
  track: Track
  score: number
}

interface MatchCacheEntry {
  targetId?: unknown
  /** QQ legacy 服务不支持按 id 补单曲详情，缓存去掉临时 URL 的完整匹配快照。 */
  targetTrack?: Track
  score?: number
  alternates?: ScoredTrack[]
  verifiedAt: number
  expiresAt: number
  mismatch?: boolean
}

interface MatchCacheArchive {
  schema: typeof TRACK_MATCH_SCHEMA
  entries: Record<string, MatchCacheEntry>
}

export class TrackMatchMismatchError extends Error {
  constructor() {
    super('TRACK_VERSION_MISMATCH')
  }
}

export interface TrackMatchResult extends ScoredTrack {
  /** 同样达到阈值、分数依次降低的其他候选。 */
  alternates?: ScoredTrack[]
}

/**
 * 不同版本互不替代：两边的版本标记集合必须完全一致。
 * 专辑名只看这几类常见标记；其余标记只看标题，避免「演唱会精选」「DJ 合集」这类专辑名误伤收录其中的录音室版本。
 */
const VERSION_PATTERNS: Array<[string, RegExp]> = [
  ['live', /\blive\b|现场/giu],
  ['instrumental', /\binstrumental\b|\bkaraoke\b|伴奏/giu],
  ['remix', /\bremix\b|\bmix\b/giu],
  ['cover', /\bcover\b|翻唱/giu],
  ['remaster', /\bremaster(?:ed)?\b|重制/giu],
  ['acoustic', /\bacoustic\b|不插电/giu],
  ['demo', /\bdemo\b/giu],
]
const TITLE_VERSION_PATTERNS: Array<[string, RegExp]> = [
  ...VERSION_PATTERNS,
  ['live', /演唱会/giu],
  ['instrumental', /\binst\b|\boff ?vocal\b|纯音乐/giu],
  ['remix', /混音版/giu],
  ['cover', /翻自|(?<![\p{L}\p{N}])[男女]声?版/giu],
  ['speed', /\bsped ?up\b|\bslowed\b|\bnightcore\b|加速|减速|降速|升调|降调|倍速/giu],
  ['dj', /\bdj\b/giu],
  ['edit', /\bradio edit\b|\bextended\b|\bshort ver(?:sion)?\b|\btv (?:size|ver(?:sion)?)\b|剪辑版/giu],
  ['rerecord', /\btaylor['’]?s version\b|\bre-?recorded\b|重录/giu],
  ['arrange', /\bpiano ver(?:sion)?\b|\borchestral? ver(?:sion)?\b|钢琴版|吉他版|交响版/giu],
  ['lang-ja', /\bjapanese ver(?:sion)?\b|日文版|日语版/giu],
  ['lang-ko', /\bkorean ver(?:sion)?\b|韩文版|韩语版/giu],
  ['lang-en', /\benglish ver(?:sion)?\b|英文版|英语版/giu],
  ['lang-yue', /\bcantonese ver(?:sion)?\b|粤语版/giu],
  ['lang-zh', /\b(?:chinese|mandarin) ver(?:sion)?\b|国语版|中文版|华语版/giu],
]
/** 不影响录音身份的括注：feat、Explicit 标记、影视宣传语等。其余括注（Reprise、Part 2、完整版…）保留比对。 */
const NOISE_SEGMENT = /\b(?:feat|ft)\b\.?|\bfeaturing\b|\bexplicit\b|\bclean\b|\bdeluxe\b|\b(?:album|single|original) ver(?:sion)?\b|\bost\b|\bfrom\s+["“《]|《[^》]*》|(?:主题|插|片头|片尾|推广|宣传|印象|角色)曲|原声带/iu

function matchesPattern(pattern: RegExp, value: string): boolean {
  pattern.lastIndex = 0
  return pattern.test(value)
}

function tagsIn(patterns: Array<[string, RegExp]>, value: string): string[] {
  return patterns.filter(([, pattern]) => matchesPattern(pattern, value)).map(([tag]) => tag)
}

function versionTagsOf(track: Track): Set<string> {
  const title = normalizeBrackets(track.name ?? '').toLocaleLowerCase()
  const album = normalizeBrackets(track.album ?? '').toLocaleLowerCase()
  return new Set([...tagsIn(TITLE_VERSION_PATTERNS, title), ...tagsIn(VERSION_PATTERNS, album)])
}

function sameSet<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false
  for (const value of a) if (!b.has(value)) return false
  return true
}

/**
 * 标题主体：「 - X」后缀等同括注 X；只去掉版本括注（另由版本标记把关）与不影响录音身份的括注，
 * 以及括注外的 feat、版本词。整串都被去掉时退回完整标题。
 */
function titleBody(name: string): string {
  const value = normalizeBrackets(name)
    .replace(/\s+[-–—]\s+(.+)$/u, ' ($1)')
    .replace(/\s+(?:feat\.?|ft\.?|featuring)\s+[^()[\]]+/giu, ' ')
    .replace(/\([^)]*\)|\[[^\]]*\]/gu, (segment) =>
      NOISE_SEGMENT.test(segment) || TITLE_VERSION_PATTERNS.some(([, pattern]) => matchesPattern(pattern, segment.toLocaleLowerCase())) ? ' ' : segment)
  const body = TITLE_VERSION_PATTERNS.reduce((text, [, pattern]) => text.replace(pattern, ' '), value.toLocaleLowerCase())
  return body.replace(/\s+/g, ' ').trim()
}

function baseTitleOf(name: string): string {
  return normalizeMatchText(titleBody(name)) || normalizeMatchText(name)
}

/** 降级搜索用的标题：保留原大小写与文字，只去掉括注、feat 与「 - X」后缀。 */
function searchTitleOf(name: string): string {
  const value = name.normalize('NFKC')
    .replace(/\s+[-–—]\s+.+$/u, '')
    .replace(/\s+(?:feat\.?|ft\.?|featuring)\s+[^()[\]（）【】]+/giu, ' ')
    .replace(/[(（[【［〔][^)）\]】］〕]*[)）\]】］〕]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return value || name.trim()
}

/** 平台常在艺人主名后附加别名括注；匹配时优先使用括注外的主名。 */
function normalizeArtistMatchText(value: string): string {
  const normalized = normalizeMatchText(value)
  const primary = normalizeMatchText(
    normalizeBrackets(value).replace(/\s*(?:\([^)]*\)|\[[^\]]*\])\s*$/u, '')
  )
  return primary || normalized
}

function splitArtistNames(value: string): string[] {
  return value.split(/\s+(?:feat\.?|ft\.?|featuring|with|x)\s+|[/、,，&×;；]/giu)
}

function artistNamesOf(track: Track): string[] {
  const names = (track.artists ?? []).map((artist) => artist.name).filter(Boolean)
  const raw = names.length > 0 ? names : [track.artist ?? '']
  return [...new Set(raw.flatMap(splitArtistNames).map(normalizeArtistMatchText).filter(Boolean))]
}

/**
 * 艺人别名：平台资料里的别名（如网易云的外文名、QQ 的「周杰伦 (Jay Chou)」），
 * 以及中外文连写的署名拆出的两部分（「G.E.M.邓紫棋」→「邓紫棋」「gem」）。只用于跨语言署名，不参与拆分。
 */
function artistAliasesOf(track: Track, names: string[]): Set<string> {
  const aliases = (track.artists ?? [])
    .flatMap((artist) => Array.isArray(artist.aliases) ? artist.aliases : [])
    .filter((alias): alias is string => typeof alias === 'string')
    .map(normalizeMatchText)
  for (const name of names) {
    const latin = name.replace(/[^a-z0-9]/g, '')
    const other = name.replace(/[a-z0-9]/g, '')
    if (!latin || !other) continue
    if ([...other].length >= 2) aliases.push(other)
    if (latin.length >= 3) aliases.push(latin)
  }
  return new Set(aliases.filter(Boolean))
}

/**
 * 艺人重合度（0–1）；无交集返回 null。真名一致优先；只能靠一侧别名对上另一侧真名时记为 viaAlias，
 * 别名可由上传者自行填写（网易云有翻唱账号把多位知名歌手填作别名），调用方须另加限制。
 */
function artistMatch(origin: Track, candidate: Track): { value: number; viaAlias: boolean } | null {
  const originNames = artistNamesOf(origin)
  const candidateNames = artistNamesOf(candidate)
  const candidateSet = new Set(candidateNames)
  const direct = originNames.filter((name) => candidateSet.has(name)).length
  let overlap = direct
  if (!direct) {
    const originAliases = artistAliasesOf(origin, originNames)
    const candidateAliases = artistAliasesOf(candidate, candidateNames)
    overlap = Math.max(
      originNames.filter((name) => candidateAliases.has(name)).length,
      candidateNames.filter((name) => originAliases.has(name)).length,
    )
  }
  if (!overlap) return null
  // 一方的艺人全部出现在另一方（如合唱版多署了一位）视为一致，否则按重合比例计分。
  const value = overlap === Math.min(originNames.length, candidateNames.length)
    ? 1
    : 0.5 + 0.5 * overlap / Math.max(originNames.length, candidateNames.length)
  return direct ? { value, viaAlias: false } : { value: value * 0.8, viaAlias: true }
}

function primaryArtistOf(track: Track): string {
  const name = (track.artists ?? []).map((artist) => artist.name).find(Boolean) ?? track.artist ?? ''
  return splitArtistNames(name)[0]?.trim() ?? ''
}

function isrcOf(track: Track): string {
  return String(track.isrc ?? track.ISRC ?? '').trim().toUpperCase()
}

/** 编辑距离相似度（0–1），只用于较长标题的轻微差异，如个别错字。 */
function similarity(a: string, b: string): number {
  const x = [...a]
  const y = [...b]
  let previous = Array.from({ length: y.length + 1 }, (_, index) => index)
  for (let i = 1; i <= x.length; i++) {
    const current = [i]
    for (let j = 1; j <= y.length; j++) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1))
    }
    previous = current
  }
  return 1 - previous[y.length] / Math.max(x.length, y.length, 1)
}

function digitsOf(value: string): string {
  return (value.match(/\d+/g) ?? []).join(',')
}

/** 时长差分档计分；超过 3 秒视为不同录音。 */
function durationValue(diff: number): number | null {
  if (diff <= 300) return 1
  if (diff <= 700) return 0.9
  if (diff <= 1500) return 0.75
  if (diff <= 3000) return 0.5
  return null
}

/**
 * 保守的同曲评分（0–100）；返回 null 表示存在硬冲突，禁止自动匹配。
 * 标题、艺人、时长分项计分取平均，缺少的字段不计入；专辑一致只作加分。
 * 硬冲突：标题主体不同、版本标记不同、艺人无交集、时长相差超过 3 秒；只靠别名对上艺人时时长须相差 1.5 秒以内。
 */
export function scoreTrackMatch(origin: Track, candidate: Track): number | null {
  const originTitle = normalizeMatchText(origin.name ?? '')
  const candidateTitle = normalizeMatchText(candidate.name ?? '')
  if (!originTitle || !candidateTitle) return null
  if (!sameSet(versionTagsOf(origin), versionTagsOf(candidate))) return null

  const originDuration = Number(origin.duration ?? 0)
  const candidateDuration = Number(candidate.duration ?? 0)
  const hasDurations = originDuration > 0 && candidateDuration > 0
  const duration = hasDurations ? durationValue(Math.abs(originDuration - candidateDuration)) : undefined
  if (duration === null) return null
  const closeDuration = duration != null && duration >= 0.75

  const originBase = baseTitleOf(origin.name ?? '')
  const candidateBase = baseTitleOf(candidate.name ?? '')
  let title: number
  if (originTitle === candidateTitle) title = 1
  else if (originBase === candidateBase) title = 0.9
  // 轻微差异只在较长标题、数字一致且时长接近时接受：短标题差一个字、编号不同往往就是另一首歌。
  else if (closeDuration && Math.min([...originBase].length, [...candidateBase].length) >= 6
    && digitsOf(originBase) === digitsOf(candidateBase) && similarity(originBase, candidateBase) >= 0.9) title = 0.7
  else return null

  const artistResult = artistMatch(origin, candidate)
  if (!artistResult || (artistResult.viaAlias && !closeDuration)) return null
  const artist = artistResult.value

  const originIsrc = isrcOf(origin)
  const candidateIsrc = isrcOf(candidate)
  if (originIsrc && candidateIsrc && originIsrc === candidateIsrc) return 100

  const values = duration == null ? [title, artist] : [title, artist, duration]
  let score = Math.round(100 * values.reduce((sum, value) => sum + value, 0) / values.length)
  if (
    origin.album &&
    candidate.album &&
    normalizeMatchText(origin.album) === normalizeMatchText(candidate.album)
  ) score += 5
  // 缺少时长无法排除不同录音，分数封顶。
  return Math.min(hasDurations ? 100 : NO_DURATION_MAX_SCORE, score)
}

function rankMatches(origin: Track, candidates: Track[]): ScoredTrack[] {
  const seen = new Set<string>()
  const ranked: ScoredTrack[] = []
  for (const candidate of candidates) {
    // 同一个 B 站视频会按标题拆出几种「歌名/歌手」读法，id 相同、歌名不同，都要参与评分。
    const id = `${candidate.source}:${String(candidate.mid ?? candidate.id ?? '')}`
    const key = candidate.source === 'bilibili' ? `${id}:${candidate.name ?? ''}` : id
    if (seen.has(key)) continue
    seen.add(key)
    const score = scoreTrackMatch(origin, candidate)
    if (score != null && score >= TRACK_MATCH_THRESHOLD) ranked.push({ track: candidate, score })
  }
  // 同分保持搜索结果的先后顺序。
  return ranked.sort((a, b) => b.score - a.score)
}

export function matchBestTrack(origin: Track, candidates: Track[]): TrackMatchResult | null {
  const [best, ...rest] = rankMatches(origin, candidates)
  if (!best) return null
  return rest.length ? { ...best, alternates: rest.slice(0, MAX_ALTERNATES) } : best
}

/** 分级搜索词：完整标题 + 歌手 → 去掉括注与 feat 的标题 + 主歌手 → 只搜标题。 */
export function matchSearchQueries(origin: Track): string[] {
  const name = String(origin.name ?? '').trim()
  if (!name) return []
  const title = searchTitleOf(name)
  return [...new Set([
    `${name} ${String(origin.artist ?? '').trim()}`.trim(),
    `${title} ${primaryArtistOf(origin)}`.trim(),
    title,
  ])]
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

function originKey(track: Track, targetSource: ProviderId, guest: boolean): string {
  // 游客匹配单独成键：只供歌词使用，不会被播放跨源兜底读到。
  return `${track.source}:${String(track.mid ?? track.id ?? '')}->${targetSource}${guest ? '#guest' : ''}`
}

/** 游客搜索为空的短期内存记录：不落盘（可能是上游限流），只避免同一首歌在几分钟内反复搜索。 */
const GUEST_EMPTY_TTL_MS = 5 * 60 * 1000
const MAX_GUEST_EMPTY = 200
const guestEmpty = new Map<string, number>()

function cacheableTrack(track: Track): Track {
  const { url: _url, pending: _pending, ...rest } = track
  return rest as Track
}

function cachedAlternates(entry: MatchCacheEntry, targetSource: ProviderId): ScoredTrack[] | undefined {
  const alternates = (Array.isArray(entry.alternates) ? entry.alternates : [])
    .filter((item) => item?.track?.source === targetSource && typeof item.score === 'number')
  return alternates.length ? alternates : undefined
}

function abortError(): Error {
  return new DOMException('Playback match cancelled', 'AbortError')
}

/**
 * 搜索并缓存目标平台的可靠同曲；负缓存 24 小时，自动命中缓存 30 天。
 * 按 matchSearchQueries 分级搜索，各级候选合并统一评分，出现达标候选即停止。
 * scope 为 guest 时走游客搜索（不带账号），独立缓存，且搜索结果为空时不写负缓存——空结果可能是上游限流。
 */
export async function findEquivalentTrack(
  origin: Track,
  targetSource: ProviderId,
  signal?: AbortSignal,
  now = Date.now(),
  strictMatch = false,
  forceRefresh = false,
  scope: 'account' | 'guest' = 'account'
): Promise<TrackMatchResult | null> {
  if (signal?.aborted) throw abortError()
  const guest = scope === 'guest' && (targetSource === 'netease' || targetSource === 'qq')
  const archive = readArchive()
  const key = originKey(origin, targetSource, guest)
  const cached = archive.entries[key]
  const provider = providerFor(targetSource)
  // 旧负缓存没有记录是否存在错版本；严格查询重新取一次，避免将错配误报成未收录。
  const hasMatchDiagnostics = cached?.targetId != null || typeof cached?.mismatch === 'boolean'
  if (!forceRefresh && cached && cached.expiresAt > now && (!strictMatch || hasMatchDiagnostics)) {
    if (cached.targetId == null) {
      if (strictMatch && cached.mismatch) throw new TrackMatchMismatchError()
      return null
    }
    const alternates = cachedAlternates(cached, targetSource)
    if (cached.targetTrack?.source === targetSource) {
      return { track: cached.targetTrack, score: cached.score ?? TRACK_MATCH_THRESHOLD, ...(alternates ? { alternates } : {}) }
    }
    // 游客缓存总带快照；没有快照时重新搜索，不用账号接口补详情。
    if (!guest) {
      const tracks = await provider.catalog.getTracksByIds([cached.targetId])
      if (signal?.aborted) throw abortError()
      const track = tracks[0]
      if (track) return { track, score: cached.score ?? TRACK_MATCH_THRESHOLD, ...(alternates ? { alternates } : {}) }
    }
    delete archive.entries[key]
    writeArchive(archive)
  }

  const queries = matchSearchQueries(origin)
  if (!queries.length) return null
  if (guest && !forceRefresh && (guestEmpty.get(key) ?? 0) > now) return null
  const candidates: Track[] = []
  let result: TrackMatchResult | null = null
  // 任何一级搜索失败都如实抛出且不写负缓存；能走到下一级说明前面还没有达标候选。
  for (const keyword of queries) {
    const found = guest
      ? await searchGuestTracks(targetSource as 'netease' | 'qq', keyword, signal)
      : await provider.catalog.searchTracks(keyword)
    if (signal?.aborted) throw abortError()
    candidates.push(...found)
    // 出现达标候选就停，未收录的歌才会用满各级搜索；同级的其他达标候选留作后备。
    result = matchBestTrack(origin, candidates)
    if (result) break
  }
  if (guest && !result && !candidates.length) {
    guestEmpty.delete(key)
    guestEmpty.set(key, now + GUEST_EMPTY_TTL_MS)
    if (guestEmpty.size > MAX_GUEST_EMPTY) guestEmpty.delete(guestEmpty.keys().next().value!)
    return null
  }
  archive.entries[key] = result
    ? {
        targetId: result.track.id,
        targetTrack: cacheableTrack(result.track),
        score: result.score,
        ...(result.alternates ? { alternates: result.alternates.map((item) => ({ track: cacheableTrack(item.track), score: item.score })) } : {}),
        verifiedAt: now,
        expiresAt: now + POSITIVE_TTL_MS,
      }
    : { verifiedAt: now, expiresAt: now + NEGATIVE_TTL_MS, mismatch: candidates.length > 0 }
  writeArchive(archive)
  if (strictMatch && !result && candidates.length) throw new TrackMatchMismatchError()
  return result
}

export function clearTrackMatchCache(): void {
  guestEmpty.clear()
  if (typeof localStorage === 'undefined') return
  localStorage.removeItem(MATCH_CACHE_KEY)
}
