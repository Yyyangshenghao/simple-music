import type { Track } from '../types/domain'

export type RoamMode = 'hot' | 'random'

const SONGS_PER_ARTIST = 10

const DEFAULT_COUNT_TARGET_TOTAL = 60
const DEFAULT_COUNT_MIN = 5
const DEFAULT_COUNT_MAX = 15

/**
 * 按已选歌手数量摊算「默认首数」:目标总曲目数约 60 首,按人数均分,夹在 [5, 15] 之间——
 * 选的歌手越少,每人分到的首数越多;选得越多,每人少一点,避免歌单无限膨胀。
 */
export function computeDefaultSongCount(artistCount: number): number {
  if (artistCount <= 0) return SONGS_PER_ARTIST
  const raw = Math.round(DEFAULT_COUNT_TARGET_TOTAL / artistCount)
  return Math.min(DEFAULT_COUNT_MAX, Math.max(DEFAULT_COUNT_MIN, raw))
}

/** Fisher-Yates 洗牌，返回新数组，不修改入参。 */
export function shuffle<T>(items: T[]): T[] {
  const result = items.slice()
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

/**
 * 从一位歌手的曲库池里按模式挑最多 count 首（默认 10）。
 * hot：池子已按热度排序（getArtistSongs 上游保证），直接取前 count。
 * random：从全池洗牌后取前 count。
 * 曲库不足 count 首时有多少取多少。
 */
export function pickArtistTracks(pool: Track[], mode: RoamMode, count = SONGS_PER_ARTIST): Track[] {
  if (mode === 'random') return shuffle(pool).slice(0, count)
  return pool.slice(0, count)
}

/**
 * 在已有已选曲目基础上,从同一曲库池里再补 needed 首（跳过已选的,不会重复）。
 * 用于「首数」步进器调大时的增量填充,不打乱已有的手动编辑结果。
 */
export function pickAdditionalTracks(pool: Track[], existing: Track[], mode: RoamMode, needed: number): Track[] {
  if (needed <= 0) return []
  const existingIds = new Set(existing.map((t) => String(t.id)))
  const remaining = pool.filter((t) => !existingIds.has(String(t.id)))
  const ordered = mode === 'random' ? shuffle(remaining) : remaining
  return ordered.slice(0, needed)
}

/** 汇总多位歌手已选出的曲目并整体打乱顺序（不按歌手分块出现）。 */
export function buildRoamTracks(perArtistPicks: Track[][]): Track[] {
  return shuffle(perArtistPicks.flat())
}
