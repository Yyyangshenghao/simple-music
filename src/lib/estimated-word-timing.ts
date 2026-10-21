import type { LyricLine, WordLyricLine, WordToken } from '../types/domain'
import { tokenizeForTiming } from './lyric-parser'
import { lyricLineDwellSec } from './lyric-tempo'

/**
 * 没有逐字时序的歌按字数估算逐字时间：每个字 ~260ms，整句揭示不超过停留时长的 85%，
 * 句尾不会拖进间奏里慢慢扫。估算只是让扫光"有节奏感"，拖长音、停顿处会和演唱对不上，
 * 所以界面上标注为「估算逐字」。英文整词是一个 token（tokenizeForTiming）。
 */
const ESTIMATE_MS_PER_CHAR = 260
const ESTIMATE_DWELL_SHARE = 0.85
const ESTIMATE_MIN_SPAN_MS = 500

const charCount = (text: string) => Array.from(text.replace(/\s+/g, '')).length

/** 一句歌词的估算逐字 token（startMs 相对行起点）。 */
export function estimateLineWords(text: string, dwellSec: number): WordToken[] {
  const tokens = tokenizeForTiming(text)
  const chars = tokens.reduce((n, token) => n + charCount(token), 0)
  if (!chars) return tokens.map((token) => ({ text: token, startMs: 0, durationMs: 0 }))
  const dwellMs = Number.isFinite(dwellSec) ? dwellSec * 1000 * ESTIMATE_DWELL_SHARE : Infinity
  const spanMs = Math.min(dwellMs, Math.max(ESTIMATE_MIN_SPAN_MS, chars * ESTIMATE_MS_PER_CHAR))
  const perChar = spanMs / chars
  let elapsed = 0
  return tokens.map((token) => {
    const durationMs = charCount(token) * perChar
    const word = { text: token, startMs: Math.round(elapsed), durationMs: Math.round(durationMs) }
    elapsed += durationMs
    return word
  })
}

/** 整首歌的估算逐字行，与 lines 一一对应；空行没有 token，界面按普通行显示。 */
export function estimateWordLines(lines: readonly LyricLine[]): WordLyricLine[] {
  return lines.map((line, index) => {
    const dwellSec = lyricLineDwellSec(lines as LyricLine[], index)
    const words = line.text.trim() ? estimateLineWords(line.text, dwellSec) : []
    const durationMs = words.length ? Math.max(...words.map((w) => w.startMs + (w.durationMs ?? 0))) : 0
    return { time: line.time, durationMs, words }
  })
}
