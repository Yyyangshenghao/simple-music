import type { Track } from '../types/domain'

/** 发现内容使用数字 qqId，绝不从 MID 或其他来源的 id 推断。 */
export function qqRelatedSongId(track: Track | null): number | null {
  if (!track || track.source !== 'qq' || track.pending) return null
  const value = track.qqId
  if (typeof value !== 'string' && typeof value !== 'number') return null
  if (!/^\d+$/.test(String(value).trim())) return null
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}
