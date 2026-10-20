/** 切行错峰弹簧：已唱过的行最先起步，当前行及以下逐行延后，形成自上而下的波浪。 */
export const LYRIC_FOLLOW_STEP_MS = 34
export const LYRIC_FOLLOW_MAX_DELAY_MS = 300
export const LYRIC_FOLLOW_DURATION_MS = 720
/** 轻微过冲的弹簧曲线，各行落位时带一点回弹。 */
export const LYRIC_FOLLOW_EASING = 'cubic-bezier(0.32, 1.26, 0.58, 1)'

export function lyricFollowDelay(lineIndex: number, activeIndex: number): number {
  const order = Math.max(0, lineIndex - activeIndex + 1)
  return Math.min(order * LYRIC_FOLLOW_STEP_MS, LYRIC_FOLLOW_MAX_DELAY_MS)
}

/** 当前行与各行的距离档位，供 CSS 计算纵深；未开始时按到首行的距离计。 */
export function lyricDistance(lineIndex: number, activeIndex: number, max = 6): number {
  return Math.min(Math.abs(lineIndex - Math.max(activeIndex, 0)) + (activeIndex < 0 ? 1 : 0), max)
}
