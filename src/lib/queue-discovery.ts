import { usePlaylistStore } from '../stores/playlist'
import { isProviderParticipating } from '../stores/providers'
import type { Track } from '../types/domain'

/** 推荐歌曲只追加，不切歌；以来源 + ID 避免重复点击产生重复队列项。 */
export function appendDiscoveredTrack(track: Track): boolean {
  if (track.source !== 'qq' || track.pending || !isProviderParticipating('qq')) return false
  const state = usePlaylistStore.getState()
  if (state.queue.some((item) => item.source === track.source && String(item.id) === String(track.id))) return false
  state.addToQueue(track)
  return true
}
