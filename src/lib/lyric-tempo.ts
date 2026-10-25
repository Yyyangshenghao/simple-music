import type { LyricLine } from '../types/domain'

/**
 * 按单句停留时长分档：快歌、说唱里一句只停留几百毫秒，固定的切行动画会让上一句
 * 还没退场、下一句已经到来。短句压缩过渡，极短句近乎硬切并整句直接点亮。
 */
export type LyricLineTempo = 'normal' | 'short' | 'micro'

/** 停留不足该值（秒）的句子压缩切行过渡。 */
export const SHORT_LINE_SEC = 1.2
/** 停留不足该值（秒）的句子不做过渡、不逐字扫光。 */
export const MICRO_LINE_SEC = 0.35
/** 短句过渡最多占用停留时长的比例，留出静止可读的时间。 */
const SHORT_LINE_TRANSITION_SHARE = 0.6
const SHORT_LINE_TRANSITION_FLOOR_SEC = 0.12
const MICRO_LINE_TRANSITION_SEC = 0.06

/** 当前句在屏上的停留时长：到下一句开始为止；末句或时间异常时视为无限长。 */
export function lyricLineDwellSec(lines: readonly LyricLine[], index: number): number {
  const line = lines[index]
  const next = lines[index + 1]
  if (!line || !next) return Infinity
  const dwell = next.time - line.time
  return Number.isFinite(dwell) && dwell >= 0 ? dwell : Infinity
}

export function lyricLineTempo(dwellSec: number): LyricLineTempo {
  if (dwellSec < MICRO_LINE_SEC) return 'micro'
  if (dwellSec < SHORT_LINE_SEC) return 'short'
  return 'normal'
}

/** 把一段切行过渡（秒）收进该句的停留时间内；正常句保持原值。 */
export function fitLyricTransition(baseSec: number, dwellSec: number): number {
  const tempo = lyricLineTempo(dwellSec)
  if (tempo === 'normal') return baseSec
  if (tempo === 'micro') return Math.min(baseSec, MICRO_LINE_TRANSITION_SEC)
  return Math.min(baseSec, Math.max(SHORT_LINE_TRANSITION_FLOOR_SEC, dwellSec * SHORT_LINE_TRANSITION_SHARE))
}

/** 极短句的逐字扫光来不及看清，整句直接点亮。 */
export function lyricLineInstantFill(dwellSec: number): boolean {
  return lyricLineTempo(dwellSec) === 'micro'
}
