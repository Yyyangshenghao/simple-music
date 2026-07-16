import { serviceFor } from './service-registry'
import type { MusicSource, Track } from '../types/domain'

/**
 * 跨音源兜底:当前音源解析不出播放 URL(VIP 付费墙/灰色下架)时,
 * 去对侧音源搜同名歌曲,匹配成功则用对侧的音频顶上(UI 仍展示原曲目元数据)。
 *
 * 匹配规则(全部满足才算同一首):
 * - 标题归一化后相等
 * - 艺人有交集(归一化后)
 * - 时长差 ≤ 3000ms(Track.duration 全项目约定为毫秒;任一侧缺时长则跳过此项)
 */

const DURATION_TOLERANCE_MS = 3000

export function otherSource(source: MusicSource): MusicSource {
  return source === 'netease' ? 'qq' : 'netease'
}

/** 归一化:小写、全角括号转半角、去空白。CJK 曲名常见空格差异(如「歌名 (Live)」)由此抹平。 */
export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/［/g, '[')
    .replace(/］/g, ']')
    .replace(/\s+/g, '')
}

/** 拆出曲目的艺人名列表:优先 artists 数组,退化到 artist 字符串按常见分隔符拆分。 */
function artistNamesOf(track: Track): string[] {
  const fromList = (track.artists ?? []).map((a) => a.name).filter(Boolean)
  if (fromList.length > 0) return fromList
  return (track.artist ?? '').split(/[/、,，&]/).map((s) => s.trim()).filter(Boolean)
}

function artistsIntersect(a: Track, b: Track): boolean {
  const setA = new Set(artistNamesOf(a).map(normalizeText))
  const namesB = artistNamesOf(b).map(normalizeText)
  return namesB.some((n) => setA.has(n))
}

function durationClose(a: Track, b: Track): boolean {
  if (!a.duration || !b.duration) return true
  return Math.abs(a.duration - b.duration) <= DURATION_TOLERANCE_MS
}

/** 从候选列表中挑与原曲目匹配的第一首(候选按搜索相关性排序);无匹配返回 null。 */
export function matchFallbackTrack(original: Track, candidates: Track[]): Track | null {
  const title = normalizeText(original.name ?? '')
  if (!title) return null
  for (const c of candidates) {
    if (normalizeText(c.name ?? '') !== title) continue
    if (!artistsIntersect(original, c)) continue
    if (!durationClose(original, c)) continue
    return c
  }
  return null
}

/** 去对侧音源搜索并匹配同一首歌;搜索失败或无匹配返回 null。 */
export async function findFallbackTrack(track: Track): Promise<Track | null> {
  const service = serviceFor(otherSource(track.source))
  const keyword = `${track.name ?? ''} ${track.artist ?? ''}`.trim()
  if (!keyword) return null
  try {
    const candidates = await service.searchTracks(keyword)
    return matchFallbackTrack(track, candidates)
  } catch {
    return null
  }
}
