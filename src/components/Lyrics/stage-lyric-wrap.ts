import type { WordToken } from '../../types/domain'
import { measureWordBoundaries, normalizeStageLyricText } from './stage-lyric-progress'

export interface StageLyricRows {
  lines: string[]
  splitWordIndex: number
  wordBoundaries: number[]
}

/** 只在整句明显超宽时分两行；逐字行只能在原生 token 边界换行。 */
export function planStageLyricRows(
  text: string,
  maxWidth: number,
  measure: (text: string) => number,
  words?: WordToken[]
): StageLyricRows {
  const normalized = normalizeStageLyricText(text)
  if (measure(normalized) <= maxWidth * 1.15) {
    return { lines: [normalized], splitWordIndex: 0, wordBoundaries: words ? measureWordBoundaries(words, measure) : [] }
  }
  const units = words?.length ? words.map((word) => word.text) : Array.from(normalized)
  if (units.length < 2) {
    return { lines: [normalized], splitWordIndex: 0, wordBoundaries: words ? measureWordBoundaries(words, measure) : [] }
  }
  let best = 1
  let bestWidth = Infinity
  let bestSpace = 0
  let bestSpaceWidth = Infinity
  for (let i = 1; i < units.length; i++) {
    const left = normalizeStageLyricText(units.slice(0, i).join(''))
    const right = normalizeStageLyricText(units.slice(i).join(''))
    if (!left || !right) continue
    const width = Math.max(measure(left), measure(right))
    if (!words?.length && units[i - 1] === ' ' && width < bestSpaceWidth) {
      bestSpace = i
      bestSpaceWidth = width
    }
    if (width < bestWidth) {
      bestWidth = width
      best = i
    }
  }
  // 有自然词间空格且两行不会明显失衡时，避免拆开英文单词。
  if (bestSpace && bestSpaceWidth <= bestWidth * 1.2) best = bestSpace
  const lines = [normalizeStageLyricText(units.slice(0, best).join('')), normalizeStageLyricText(units.slice(best).join(''))]
  const wordBoundaries = words
    ? [
        ...measureWordBoundaries(words.slice(0, best), measure).map((v) => v * 0.5),
        ...measureWordBoundaries(words.slice(best), measure).slice(1).map((v) => 0.5 + v * 0.5)
      ]
    : []
  return { lines, splitWordIndex: words ? best : 0, wordBoundaries }
}
