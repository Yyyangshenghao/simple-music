import type { Track } from '../types/domain'

/** 网易云歌手目录会返回明确版权状态；QQ 的 playable=false 只是尚未解析播放地址。 */
export function isCatalogUnavailable(track: Track): boolean {
  return track.source === 'netease' && track.playable === false
}
