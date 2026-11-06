import { bilibiliTrackDisplay } from '../lib/bilibili-track-display'
import { matchedBilibiliTrack, useBilibiliCoverStore } from '../stores/bilibili-covers'
import type { Track } from '../types/domain'

/** 展示只消费后台识别结果，不因列表挂载而发起歌曲搜索。 */
export function useBilibiliTrackDisplay(track: Track | null | undefined) {
  const matched = useBilibiliCoverStore(state => matchedBilibiliTrack(track, state.entries))
  return bilibiliTrackDisplay(track, matched)
}
