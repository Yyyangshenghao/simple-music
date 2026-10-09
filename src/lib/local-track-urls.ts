import { api } from './api'
import type { Track } from '../types/domain'

/** 本地存档的端口和 token 属于旧会话，按索引 ID 重建当前资源地址。 */
export function restoreLocalTrackUrls(track: Track): Track {
  if (track.source !== 'local') return track
  const id = String(track.id)
  return {
    ...track,
    url: api.url('/api/local/audio', { id }),
    cover: track.cover ? api.url('/api/local/cover', { id }) : undefined,
  }
}
