import { api } from './api'
import type { Track } from '../types/domain'
import { accompanimentId, accompanimentOriginal, localAudioUrl } from './karaoke-library'

/** 本地存档的端口和 token 属于旧会话，按索引 ID 重建当前资源地址。 */
export function restoreLocalTrackUrls(track: Track): Track {
  if (track.source !== 'local') return track
  const id = String(track.id)
  return {
    ...track,
    url: localAudioUrl(id),
    cover: accompanimentId(track) ? accompanimentOriginal(track)?.cover ?? track.cover : track.cover ? api.url('/api/local/cover', { id }) : undefined,
  }
}
