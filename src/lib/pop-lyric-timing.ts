import type { WordLyricLine } from '../types/domain'
import { hasWordTiming } from './word-highlight-timeline'
import { lyricLineTempo } from './lyric-tempo'
import { estimateLineWords } from './estimated-word-timing'

/**
 * 跃字模式的逐词时序：每个词在轮到它时从下方弹出。原生逐字时序直接使用；
 * 纯 LRC 按字数估一个比整段间隔更紧凑的揭示窗口，避免句尾在间奏里慢吞吞地冒字。
 * 歌手拖长音的词按实际演唱时长放大，让一句里自然出现视觉重心。
 */

export interface PopWord {
  text: string
  /** 相对行起点的毫秒 */
  startMs: number
  durationMs: number
  /** 字号倍数；拖长音的词 > 1 */
  scale: number
  /** 弹出动画时长（毫秒），0 表示直接出现 */
  popMs: number
}

/** 比实际演唱稍早一点弹出，动画峰值才落在拍上。 */
export const POP_LEAD_MS = 60
const POP_MAX_MS = 380
const POP_MIN_MS = 140
const EMPHASIS_RATIO = 1.8
const EMPHASIS_MIN_MS = 380
const EMPHASIS_MAX_SCALE = 1.32

const charCount = (text: string) => Array.from(text.replace(/\s+/g, '')).length

function median(values: number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** 拖长音放大：单字演唱时长显著长于本句中位数的词放大，最多放大到 EMPHASIS_MAX_SCALE。 */
export function popEmphasis(words: readonly { text: string; durationMs: number }[]): number[] {
  const perChar = words.map((word) => {
    const chars = charCount(word.text)
    return chars ? word.durationMs / chars : 0
  })
  const voiced = perChar.filter((value) => value > 0)
  const base = median(voiced)
  if (voiced.length < 3 || base <= 0) return words.map(() => 1)
  return words.map((word, i) => {
    const ratio = perChar[i] / base
    if (ratio < EMPHASIS_RATIO || word.durationMs < EMPHASIS_MIN_MS) return 1
    return Math.min(EMPHASIS_MAX_SCALE, 1 + (ratio - 1) * 0.12)
  })
}

/** 生成一句歌词的跃字序列。wordLine 有原生逐字时序时优先使用，否则按 text 估算。 */
export function buildPopWords(text: string, wordLine: WordLyricLine | undefined, dwellSec: number): PopWord[] {
  const base = wordLine && hasWordTiming(wordLine.words)
    ? wordLine.words.map((word) => ({ text: word.text, startMs: word.startMs, durationMs: word.durationMs ?? 0 }))
    : estimateLineWords(text, dwellSec).map((word) => ({ text: word.text, startMs: word.startMs, durationMs: word.durationMs ?? 0 }))
  const micro = lyricLineTempo(dwellSec) === 'micro'
  const scales = popEmphasis(base)
  return base.map((word, i) => ({
    ...word,
    scale: scales[i],
    popMs: micro ? 0 : Math.round(Math.min(POP_MAX_MS, Math.max(POP_MIN_MS, word.durationMs * 0.9)))
  }))
}
