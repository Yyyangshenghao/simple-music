import type { WordToken } from '../types/domain'

export function hasWordTiming(words: readonly WordToken[]): boolean {
  return words.length > 0 && words.every(word =>
    Number.isFinite(word.startMs) && word.startMs >= 0
    && word.durationMs !== undefined && Number.isFinite(word.durationMs) && word.durationMs >= 0
  )
}

/** 浏览器负责高亮裁剪，媒体时钟负责定位；动画不自行计时，暂停与跳播不会漂移。 */
export function createWordHighlightTimeline(elements: readonly Element[], words: readonly WordToken[]) {
  if (elements.length !== words.length || !hasWordTiming(words)) return null
  const entries = elements.map((element, i) => {
    const word = words[i]
    // 零时长标记在时间戳处瞬时完成；非零时长完全保留原始数据。
    const duration = word.durationMs === 0 ? 1 : word.durationMs!
    const animation = element.animate([
      { clipPath: 'inset(0 100% 0 0)' },
      { clipPath: 'inset(0 0% 0 0)' }
    ], { duration, fill: 'both', easing: 'linear' })
    animation.pause()
    return { animation, start: word.startMs, duration, instant: word.durationMs === 0 }
  })
  return {
    seek(elapsedMs: number) {
      for (const entry of entries) {
        const position = elapsedMs < entry.start ? 0 : entry.instant
          ? entry.duration : Math.min(entry.duration, elapsedMs - entry.start)
        if (position !== entry.animation.currentTime) {
          entry.animation.currentTime = position
        }
      }
    },
    dispose() {
      for (const entry of entries) entry.animation.cancel()
    }
  }
}
