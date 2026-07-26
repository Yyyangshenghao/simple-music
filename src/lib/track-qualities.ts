import { api } from './api'
import type { Track } from '../types/domain'

/** 单曲真实可得的音质档(服务端逐档探测的结果),按从高到低排序。 */
export interface TrackQualityOption {
  level: string
  label: string
  br?: number
}

/**
 * 查询曲目在其所属音源上实际存在的音质档;本地音乐无档位概念,返回空。
 * 服务端逐档串行探测(最多 8 档),弱网下单次可能超过全局兜底 30s,单独放宽到 60s。
 */
export function fetchTrackQualities(track: Track): Promise<TrackQualityOption[]> {
  if (track.source === 'local') return Promise.resolve([])
  const req =
    track.source === 'qq'
      ? api.get<{ qualities?: TrackQualityOption[] }>(
          '/api/qq/song/qualities',
          { mid: String(track.mid ?? track.id ?? '') },
          { timeoutMs: 60_000 }
        )
      : api.get<{ qualities?: TrackQualityOption[] }>(
          '/api/song/qualities',
          { id: String(track.id ?? '') },
          { timeoutMs: 60_000 }
        )
  return req.then((r) => r.qualities ?? [])
}
