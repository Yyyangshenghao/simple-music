import type { PlaybackStatus } from './audio-engine'
import type { HighlightRange } from './highlight-offset'

/** 片段接近结束时只负责触发下一首，不再把进度跳回片段起点循环播放。 */
export function shouldAdvanceShuangeClip(
  position: number,
  status: PlaybackStatus,
  range: HighlightRange | null
): boolean {
  if (!range || range.endSec <= range.startSec || status !== 'playing') return false
  return position >= range.endSec - 0.3
}

/** 补货失败或去重后仍停在原卡片时释放防重入锁，允许下一次 ended/进度事件重试。 */
export function shouldReleaseShuangeAdvanceLock(
  beforeIndex: number,
  afterIndex: number,
  active: boolean
): boolean {
  return active && afterIndex === beforeIndex
}
