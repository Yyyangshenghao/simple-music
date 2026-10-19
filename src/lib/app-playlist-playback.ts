import type { Track } from '../types/domain'
import type { ProviderRuntimeState } from '../stores/providers'
import type { ProviderId } from '../providers/types'
import type { OfflineCacheStatus } from './offline-cache'
import { restoreLocalTrackUrls } from './local-track-urls'
import { appPlaylistTrackKey } from '../stores/app-playlists'

export interface AppPlaylistPlaybackContext {
  providers: Record<ProviderId, ProviderRuntimeState>
  localTracks: Map<string, Track> | null
  localError?: string
  offline: Record<string, OfflineCacheStatus>
}

/** 只计算当前可用状态，绝不从应用歌单中移除失效收藏。
 *  invalid 表示歌曲本身已失效（本地文件不存在、曲目下架），与登录或平台停用这类可恢复状态区分。 */
export function appPlaylistTrackState(track: Track, context: AppPlaylistPlaybackContext): { track: Track; available: boolean; status?: string; invalid?: boolean } {
  if (track.source === 'local') {
    const current = context.localTracks?.get(String(track.id))
    const missing = !!context.localTracks && !context.localError
    return current ? { track: restoreLocalTrackUrls(current), available: true }
      : { track: restoreLocalTrackUrls(track), available: false, status: context.localError || (context.localTracks ? '本地文件不存在' : '正在检查本地文件'), ...(missing ? { invalid: true } : {}) }
  }
  if (track.playable === false) return { track, available: false, status: '曲目暂不可用', invalid: true }
  const offline = context.offline[appPlaylistTrackKey(track)]
  if (track.source !== 'apple' && offline?.entryId && offline.state !== 'missing') return { track, available: true, status: '可离线播放' }
  const provider = context.providers[track.source]
  const status = !provider.enabled ? '平台已停用'
    : provider.auth !== 'authenticated' ? provider.auth === 'expired' ? '登录已失效' : '请先登录'
      : provider.playbackAvailable === false ? '平台暂不可用' : undefined
  return { track, available: !status, status: status || (track.pending ? '播放时加载详情' : undefined) }
}

export function appPlaylistPlaybackTracks(tracks: Track[], context: AppPlaylistPlaybackContext): Track[] {
  return tracks.map(track => appPlaylistTrackState(track, context)).filter(item => item.available)
    .map(item => JSON.parse(JSON.stringify(item.track)) as Track)
}
