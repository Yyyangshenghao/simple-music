// 歌单懒加载的窗口计算与队列构建:全骨架(trackIds 全量已知)+ 按窗口补详情。
// 纯函数,不持状态;状态在 useLazyPlaylist 的模块级缓存里。

import type { Track, MusicSource } from '../types/domain'

/** 详情补拉的窗口大小(首) */
export const TRACK_WINDOW = 100

/** 覆盖 [start, end) 行区间的窗口序号列表(越界自动截到 total)。 */
export function windowIndicesFor(start: number, end: number, windowSize: number, total: number): number[] {
  if (total <= 0 || windowSize <= 0 || end <= start) return []
  const first = Math.floor(Math.max(0, Math.min(start, total - 1)) / windowSize)
  const last = Math.floor((Math.max(1, Math.min(end, total)) - 1) / windowSize)
  const out: number[] = []
  for (let w = first; w <= last; w++) out.push(w)
  return out
}

/** 第 w 个窗口对应的行区间 [start, end),末窗口截断到 total。 */
export function windowSpan(w: number, windowSize: number, total: number): { start: number; end: number } {
  return { start: w * windowSize, end: Math.min((w + 1) * windowSize, total) }
}

/** 固定行高虚拟列表的可视行区间 [start, end),含 overscan;listTop 为列表相对滚动内容顶部的偏移。 */
export function virtualRange(
  scrollTop: number,
  viewportHeight: number,
  listTop: number,
  rowHeight: number,
  total: number,
  overscan: number
): { start: number; end: number } {
  if (total <= 0 || rowHeight <= 0) return { start: 0, end: 0 }
  const offset = scrollTop - listTop
  let start = Math.max(0, Math.floor(offset / rowHeight) - overscan)
  let end = Math.min(total, Math.ceil((offset + viewportHeight) / rowHeight) + overscan)
  start = Math.min(start, total)
  end = Math.max(start, end)
  return { start, end }
}

/** 仅有 id 的占位曲目:详情播到/滚到时再补,网易播放 URL 只需 id 所以占位也可播。 */
export function makePlaceholderTrack(id: unknown, source: MusicSource): Track {
  return { provider: source, source, type: 'song', id, name: '', artist: '', artists: [], pending: true }
}

/** 按完整 trackIds 构建播放队列:已加载详情的用真曲目,其余用占位。 */
export function buildQueue(trackIds: unknown[], tracks: (Track | null)[], source: MusicSource): Track[] {
  return trackIds.map((id, i) => tracks[i] ?? makePlaceholderTrack(id, source))
}
