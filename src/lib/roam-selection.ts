import type { Track } from '../types/domain'

export type RoamMode = 'hot' | 'random'

const SONGS_PER_ARTIST = 10

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
 * 从一位歌手的曲库池里按模式挑最多 10 首。
 * hot：池子已按热度排序（getArtistSongs 上游保证），直接取前 10。
 * random：从全池洗牌后取前 10。
 * 曲库不足 10 首时有多少取多少。
 */
export function pickArtistTracks(pool: Track[], mode: RoamMode): Track[] {
  if (mode === 'random') return shuffle(pool).slice(0, SONGS_PER_ARTIST)
  return pool.slice(0, SONGS_PER_ARTIST)
}

/** 汇总多位歌手已选出的曲目并整体打乱顺序（不按歌手分块出现）。 */
export function buildRoamTracks(perArtistPicks: Track[][]): Track[] {
  return shuffle(perArtistPicks.flat())
}
