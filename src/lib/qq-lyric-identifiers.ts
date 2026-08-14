import type { Track } from '../types/domain'
import type { QueryParams } from './api'

export interface QQLyricIdentifiers extends QueryParams {
  mid?: string
  id?: string | number
}

/**
 * QQ 歌词接口的 songMID 与 songID 是两套独立标识：
 * mid 只取字符串曲目 MID，id 只取真实的纯数字 qqId。
 */
export function qqLyricIdentifiers(track: Track): QQLyricIdentifiers {
  const mid = String(track.songmid || track.mid || '').trim()
  const rawId = String(track.qqId ?? '').trim()
  const id = /^\d+$/.test(rawId)
    ? (typeof track.qqId === 'number' ? track.qqId : rawId)
    : undefined
  return {
    mid: mid || undefined,
    id,
  }
}
