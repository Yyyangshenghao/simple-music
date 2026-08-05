import type { MusicSource, Track } from '../types/domain'

const STORAGE_KEY = 'simplemusic-shuange-profile-v1'
const CANDIDATE_CACHE_KEY = 'simplemusic-shuange-candidate-cache-v1'
const MAX_SEEN_PER_SOURCE = 240
const MAX_SCORE_KEYS = 400
const MAX_CANDIDATES_PER_SOURCE = 180

export type ShuangeFeedback = 'quick-skip' | 'listened' | 'like' | 'unlike' | 'not-interested' | 'play-full'

interface ShuangeProfile {
  seen: Partial<Record<MusicSource, string[]>>
  trackScores: Record<string, number>
  artistScores: Record<string, number>
  featureScores: Record<string, number>
  seedArtistScores: Record<string, number>
  seedFeatureScores: Record<string, number>
  tasteSeededOn: Partial<Record<MusicSource, string>>
}

interface ShuangeCandidateCache {
  candidates: Partial<Record<MusicSource, Track[]>>
  cachedOn: Partial<Record<MusicSource, string>>
}

export interface ShuangeRankingProfile {
  seenKeys: string[]
  trackScores: Record<string, number>
  artistScores: Record<string, number>
  featureScores?: Record<string, number>
}

const EMPTY_PROFILE: ShuangeProfile = {
  seen: {}, trackScores: {}, artistScores: {}, featureScores: {},
  seedArtistScores: {}, seedFeatureScores: {}, tasteSeededOn: {},
}
let profile = readProfile()
let candidateCache = readCandidateCache()
let persistTimer: ReturnType<typeof setTimeout> | null = null

function trackKey(track: Track): string {
  return `${track.source}:${String(track.id)}`
}

function artistKey(track: Track): string {
  const artist = track.artists?.[0]
  const identity = artist?.id ?? track.artistId ?? artist?.name ?? track.artist.trim().toLowerCase()
  return `${track.source}:${String(identity || 'unknown')}`
}

function readProfile(): ShuangeProfile {
  if (typeof localStorage === 'undefined') return { ...EMPTY_PROFILE, seen: {} }
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '') as Partial<ShuangeProfile>
    const seen: ShuangeProfile['seen'] = {}
    for (const source of ['netease', 'qq', 'local'] as const) {
      const items = value.seen?.[source]
      if (Array.isArray(items)) seen[source] = items.filter((item): item is string => typeof item === 'string').slice(0, MAX_SEEN_PER_SOURCE)
    }
    return {
      seen,
      trackScores: sanitizeScores(value.trackScores),
      artistScores: sanitizeScores(value.artistScores),
      featureScores: sanitizeScores(value.featureScores),
      seedArtistScores: sanitizeScores(value.seedArtistScores),
      seedFeatureScores: sanitizeScores(value.seedFeatureScores),
      tasteSeededOn: readTasteSeedDays(value.tasteSeededOn),
    }
  } catch {
    return { ...EMPTY_PROFILE, seen: {} }
  }
}

function readTasteSeedDays(value: unknown): ShuangeProfile['tasteSeededOn'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const result: ShuangeProfile['tasteSeededOn'] = {}
  for (const source of ['netease', 'qq'] as const) {
    const day = (value as Record<string, unknown>)[source]
    if (typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day)) result[source] = day
  }
  return result
}

function isCandidateTrack(value: unknown): value is Track {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const track = value as Partial<Track>
  return track.id != null && typeof track.name === 'string' && (track.source === 'netease' || track.source === 'qq')
}

function localDay(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function readCandidateCache(): ShuangeCandidateCache {
  if (typeof localStorage === 'undefined') return { candidates: {}, cachedOn: {} }
  try {
    const value = JSON.parse(localStorage.getItem(CANDIDATE_CACHE_KEY) ?? '') as Partial<ShuangeCandidateCache>
    const candidates: ShuangeCandidateCache['candidates'] = {}
    const cachedOn: ShuangeCandidateCache['cachedOn'] = {}
    const today = localDay()
    for (const source of ['netease', 'qq'] as const) {
      const items = value.candidates?.[source]
      if (value.cachedOn?.[source] === today && Array.isArray(items)) {
        candidates[source] = items.filter(isCandidateTrack).slice(0, MAX_CANDIDATES_PER_SOURCE)
        cachedOn[source] = today
      }
    }
    return { candidates, cachedOn }
  } catch {
    return { candidates: {}, cachedOn: {} }
  }
}

function persistProfile(): void {
  if (typeof localStorage === 'undefined') return
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    persistTimer = null
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(profile))
      localStorage.setItem(CANDIDATE_CACHE_KEY, JSON.stringify(candidateCache))
    } catch {
      // 推荐画像丢失不影响播放
    }
  }, 300)
}

function trimScores(scores: Record<string, number>): Record<string, number> {
  const entries = Object.entries(scores)
  if (entries.length <= MAX_SCORE_KEYS) return scores
  return Object.fromEntries(entries.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, MAX_SCORE_KEYS))
}

function clampScore(value: number): number {
  return Math.max(-10, Math.min(10, value))
}

function sanitizeScores(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const scores: Record<string, number> = {}
  for (const [key, score] of Object.entries(value)) {
    if (typeof score === 'number' && Number.isFinite(score)) scores[key] = clampScore(score)
  }
  return trimScores(scores)
}

function mergeScores(base: Record<string, number>, feedback: Record<string, number>): Record<string, number> {
  const merged = { ...base }
  for (const [key, score] of Object.entries(feedback)) merged[key] = clampScore((merged[key] ?? 0) + score)
  return trimScores(merged)
}

function textOf(track: Track): string {
  return [track.name, track.artist, track.album].filter(Boolean).join(' ').toLowerCase()
}

function hintTextOf(track: Track): string {
  return Array.isArray(track.recommendationHints)
    ? track.recommendationHints.filter((item): item is string => typeof item === 'string').join(' ').toLowerCase()
    : ''
}

function featureKeys(track: Track): string[] {
  const text = textOf(track)
  const hints = hintTextOf(track)
  const features: string[] = []
  // 语种只信任曲目本身的文字，或歌单中明确写出的语种；通用中文歌单名不能把歌曲误判为华语。
  if (/日语|日文|j-pop/.test(text) || /日语|日文|j-pop/.test(hints)) features.push('language:ja')
  else if (/韩语|韩文|k-pop/.test(text) || /韩语|韩文|k-pop/.test(hints)) features.push('language:ko')
  else if (/华语|国语|粤语|中文/.test(text) || /华语|国语|粤语|中文/.test(hints)) features.push('language:zh')
  else if (/欧美|英文|english|western/.test(text) || /欧美|英文|english|western/.test(hints)) features.push('language:latin')
  else if (/[\u3040-\u30ff]/.test(text)) features.push('language:ja')
  else if (/[\uac00-\ud7af]/.test(text)) features.push('language:ko')
  else if (/[\u4e00-\u9fff]/.test(text)) features.push('language:zh')
  else if (/[a-z]/i.test(text)) features.push('language:latin')
  for (const [key, pattern] of [
    ['style:rnb', /r&b|rnb|soul/],
    ['style:hiphop', /hip\s*hop|嘻哈|说唱|rap/],
    ['style:rock', /rock|摇滚|朋克|金属/],
    ['style:folk', /folk|民谣|原声|acoustic/],
    ['style:electronic', /electronic|电子|edm|house|techno/],
    ['style:jazz', /jazz|爵士|blues/],
    ['style:pop', /pop|流行|k-pop|j-pop/],
    ['energy:calm', /慢歌|安静|睡眠|治愈|轻音乐|钢琴/],
    ['energy:upbeat', /快歌|轻快|动感|舞曲|派对/],
  ] as const) {
    if (pattern.test(`${text} ${hints}`)) features.push(key)
  }
  return features
}

function featureAffinity(track: Track, scores: Record<string, number>): { style: number; language: number; energy: number } {
  let style = 0
  let language = 0
  let energy = 0
  for (const key of featureKeys(track)) {
    const score = scores[key] ?? 0
    if (key.startsWith('style:')) style += score
    else if (key.startsWith('language:')) language += score
    else if (key.startsWith('energy:')) energy += score
  }
  return { style, language, energy }
}

function mixByTaste(ranked: Track[], ranking: ShuangeRankingProfile): Track[] {
  if (ranked.length < 4) return ranked
  const featureScores = ranking.featureScores ?? {}
  const buckets = { favorite: [] as Track[], related: [] as Track[], explore: [] as Track[] }
  for (const track of ranked) {
    const features = featureAffinity(track, featureScores)
    const direct = (ranking.trackScores[trackKey(track)] ?? 0) >= 1 || (ranking.artistScores[artistKey(track)] ?? 0) >= 0.8 || features.style >= 0.8
    if (direct) buckets.favorite.push(track)
    else if (features.language >= 0.6 || features.energy >= 0.6) buckets.related.push(track)
    else buckets.explore.push(track)
  }
  const learnedScores = [
    ...Object.values(ranking.trackScores),
    ...Object.values(ranking.artistScores),
    ...Object.values(featureScores),
  ]
  const positive = learnedScores.reduce((sum, score) => sum + Math.max(0, score), 0)
  const negative = learnedScores.reduce((sum, score) => sum + Math.max(0, -score), 0)
  const confidence = Math.min(1, (positive + negative) / 18)
  const satisfaction = positive / Math.max(1, positive + negative)
  // 冷启动更开放；满意度越高越收敛到偏好，连续负反馈则增加相邻和探索候选。
  const weights = {
    favorite: 0.28 + confidence * satisfaction * 0.42,
    explore: 0.16 + (1 - confidence) * 0.2 + confidence * (1 - satisfaction) * 0.18,
    related: 0,
  }
  weights.related = 1 - weights.favorite - weights.explore
  const result: Track[] = []
  const used = new Set<string>()
  const selectedByBucket = { favorite: 0, related: 0, explore: 0 }
  const keys = ['favorite', 'related', 'explore'] as const
  while (result.length < ranked.length) {
    const nextBucket = keys
      .filter((key) => buckets[key].length > selectedByBucket[key])
      .sort((a, b) => selectedByBucket[a] / weights[a] - selectedByBucket[b] / weights[b])[0]
    if (!nextBucket) break
    const track = buckets[nextBucket][selectedByBucket[nextBucket]++]
    if (!used.has(trackKey(track))) {
      result.push(track)
      used.add(trackKey(track))
    }
  }
  // 任一桶不足时，按原排序补满，既不牺牲新鲜度也不制造空批次。
  return [...result, ...ranked.filter((track) => !used.has(trackKey(track)))]
}

/**
 * 将候选曲目按“新鲜度 + 本地偏好 + 少量探索”排序，并尽量避免相邻同歌手。
 * 上游推荐仍是主要候选源；本地排序只解决重复和短期反馈，不冒充云端推荐模型。
 */
export function rankShuangeCandidates(
  candidates: Track[],
  ranking: ShuangeRankingProfile,
  random: () => number = Math.random
): Track[] {
  const unique: Track[] = []
  const known = new Set<string>()
  for (const track of candidates) {
    if (!track || track.id == null || track.source === 'local') continue
    const key = trackKey(track)
    if (known.has(key)) continue
    known.add(key)
    unique.push(track)
  }

  const seenIndex = new Map(ranking.seenKeys.map((key, index) => [key, index]))
  const rankGroup = (tracks: Track[], isFresh: boolean): Track[] => {
    const scored = tracks.map((track) => {
      const key = trackKey(track)
      // 喜好用于候选内排序；随机项与喜好项同量级，避免少数高分歌曲垄断。
      const features = featureAffinity(track, ranking.featureScores ?? {})
      const preference = (ranking.trackScores[key] ?? 0) * 6 + (ranking.artistScores[artistKey(track)] ?? 0) * 4 + features.style * 3 + features.language * 1.5 + features.energy
      const revisit = isFresh ? 0 : Math.min(seenIndex.get(key) ?? 0, MAX_SEEN_PER_SOURCE) * 4
      const aversion = Math.max(0, -(ranking.trackScores[key] ?? 0)) + Math.max(0, -(ranking.artistScores[artistKey(track)] ?? 0)) * 2 + Math.max(0, -features.style) * 1.5
      const explorationRange = aversion >= 2 ? 16 : aversion >= 0.8 ? 48 : 100
      return { track, score: revisit + preference + random() * explorationRange }
    })
    const result: Track[] = []
    const artistCounts = new Map<string, number>()
    while (scored.length) {
      const recentArtists = new Set(result.slice(-2).map(artistKey))
      let selectedIndex = 0
      let selectedScore = -Infinity
      for (let index = 0; index < scored.length; index++) {
        const entry = scored[index]
        const artist = artistKey(entry.track)
        const densityPenalty = (artistCounts.get(artist) ?? 0) * 45 + (recentArtists.has(artist) ? 90 : 0)
        const diversifiedScore = entry.score - densityPenalty
        if (diversifiedScore > selectedScore) {
          selectedIndex = index
          selectedScore = diversifiedScore
        }
      }
      const selected = scored.splice(selectedIndex, 1)[0].track
      const artist = artistKey(selected)
      artistCounts.set(artist, (artistCounts.get(artist) ?? 0) + 1)
      result.push(selected)
    }
    return result
  }

  // 新曲是硬优先级。候选池耗尽后才按“越久未出现越优先”回收旧曲。
  const fresh = unique.filter((track) => !seenIndex.has(trackKey(track)))
  const revisits = unique.filter((track) => seenIndex.has(trackKey(track)))
  return [...mixByTaste(rankGroup(fresh, true), ranking), ...mixByTaste(rankGroup(revisits, false), ranking)]
}

export function rankCurrentShuangeCandidates(candidates: Track[]): Track[] {
  const source = candidates[0]?.source
  return rankShuangeCandidates(candidates, {
    seenKeys: source ? profile.seen[source] ?? [] : [],
    trackScores: profile.trackScores,
    artistScores: mergeScores(profile.seedArtistScores, profile.artistScores),
    featureScores: mergeScores(profile.seedFeatureScores, profile.featureScores),
  })
}

export function recordShuangeExposure(track: Track): void {
  recordShuangeExposures([track])
}

function recordShuangeExposures(tracks: Track[]): void {
  const seen = { ...profile.seen }
  for (const track of tracks) {
    if (!track || track.source === 'local') continue
    const key = trackKey(track)
    const sourceSeen = seen[track.source] ?? []
    seen[track.source] = [key, ...sourceSeen.filter((item) => item !== key)].slice(0, MAX_SEEN_PER_SOURCE)
  }
  profile = {
    ...profile,
    seen,
  }
  persistProfile()
}

/**
 * 本地候选池保存在 Electron 用户数据目录的 localStorage 中：
 * 高频换一批优先消费这里的库存，后台网络请求只负责补货。
 */
export function stashShuangeCandidates(candidates: Track[]): void {
  const next = { ...candidateCache.candidates }
  const cachedOn = { ...candidateCache.cachedOn }
  const today = localDay()
  for (const source of ['netease', 'qq'] as const) {
    const existing = next[source] ?? []
    const known = new Set(existing.map(trackKey))
    const additions = candidates.filter((track) => {
      if (track.source !== source || track.id == null) return false
      const key = trackKey(track)
      if (known.has(key)) return false
      known.add(key)
      return true
    })
    next[source] = [...existing, ...additions].slice(-MAX_CANDIDATES_PER_SOURCE)
    if (additions.length) cachedOn[source] = today
  }
  candidateCache = { candidates: next, cachedOn }
  persistProfile()
}

/** 取出一批候选即从池中消费，并记为已展示，避免同一首歌在连续换批中折返。 */
export function takeShuangeCandidateBatch(source: MusicSource, count: number): Track[] {
  if (source === 'local' || count <= 0) return []
  const pool = candidateCache.candidates[source] ?? []
  const selected = rankShuangeCandidates(pool, {
    seenKeys: profile.seen[source] ?? [],
    trackScores: profile.trackScores,
    artistScores: mergeScores(profile.seedArtistScores, profile.artistScores),
    featureScores: mergeScores(profile.seedFeatureScores, profile.featureScores),
  }).slice(0, count)
  if (!selected.length) return []
  const keys = new Set(selected.map(trackKey))
  candidateCache = {
    candidates: { ...candidateCache.candidates, [source]: pool.filter((track) => !keys.has(trackKey(track))) },
    cachedOn: candidateCache.cachedOn,
  }
  recordShuangeExposures(selected)
  return selected
}

export function recordShuangeFeedback(track: Track, feedback: ShuangeFeedback): void {
  const weights: Record<ShuangeFeedback, { track: number; artist: number; feature: number }> = {
    'quick-skip': { track: -1.5, artist: -0.55, feature: -0.25 },
    listened: { track: 0.5, artist: 0.2, feature: 0.08 },
    like: { track: 3, artist: 1.5, feature: 0.7 },
    unlike: { track: -3, artist: -1.5, feature: -0.7 },
    'not-interested': { track: -5, artist: -2.2, feature: -1.2 },
    'play-full': { track: 4, artist: 2, feature: 1 },
  }
  const weight = weights[feedback]
  const tKey = trackKey(track)
  const aKey = artistKey(track)
  const featureScores = { ...profile.featureScores }
  for (const key of featureKeys(track)) featureScores[key] = clampScore((featureScores[key] ?? 0) + weight.feature)
  profile = {
    ...profile,
    trackScores: trimScores({ ...profile.trackScores, [tKey]: clampScore((profile.trackScores[tKey] ?? 0) + weight.track) }),
    artistScores: trimScores({ ...profile.artistScores, [aKey]: clampScore((profile.artistScores[aKey] ?? 0) + weight.artist) }),
    featureScores: trimScores(featureScores),
  }
  persistProfile()
}

/** 每天导入一次账号级口味：听歌排行体现常听，收藏曲目给予更高权重。 */
export function seedShuangeTaste(source: MusicSource, rankedTracks: Track[], likedTracks: Track[]): void {
  if (source === 'local' || profile.tasteSeededOn[source] === localDay()) return
  const artistScores: Record<string, number> = {}
  const featureScores: Record<string, number> = {}
  const learn = (tracks: Track[], base: number, featureWeight: number) => {
    tracks.forEach((track, index) => {
      if (track.source !== source) return
      const recency = 1 - Math.min(index, 99) / 180
      const artist = artistKey(track)
      artistScores[artist] = clampScore((artistScores[artist] ?? 0) + base * recency)
      for (const key of featureKeys(track)) featureScores[key] = clampScore((featureScores[key] ?? 0) + featureWeight * recency)
    })
  }
  learn(rankedTracks.slice(0, 100), 0.45, 0.1)
  learn(likedTracks.slice(0, 100), 1.1, 0.2)
  if (!rankedTracks.length && !likedTracks.length) return
  profile = {
    ...profile,
    seedArtistScores: trimScores(artistScores),
    seedFeatureScores: trimScores(featureScores),
    tasteSeededOn: { ...profile.tasteSeededOn, [source]: localDay() },
  }
  persistProfile()
}

export function __resetShuangeRecommendationProfile(next: ShuangeRankingProfile = {
  seenKeys: [],
  trackScores: {},
  artistScores: {},
}): void {
  if (persistTimer) {
    clearTimeout(persistTimer)
    persistTimer = null
  }
  profile = {
    seen: { netease: next.seenKeys },
    trackScores: next.trackScores,
    artistScores: next.artistScores,
    featureScores: next.featureScores ?? {},
    seedArtistScores: {},
    seedFeatureScores: {},
    tasteSeededOn: {},
  }
  candidateCache = { candidates: {}, cachedOn: {} }
}

export function __getShuangeRecommendationProfile(): ShuangeRankingProfile {
  return {
    seenKeys: [...(profile.seen.netease ?? [])],
    trackScores: { ...profile.trackScores },
    artistScores: mergeScores(profile.seedArtistScores, profile.artistScores),
    featureScores: mergeScores(profile.seedFeatureScores, profile.featureScores),
  }
}

export function __getShuangeCandidatePool(source: MusicSource = 'netease'): Track[] {
  return [...(candidateCache.candidates[source] ?? [])]
}
