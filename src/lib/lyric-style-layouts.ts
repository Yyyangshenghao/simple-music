import type { WordLyricLine } from '../types/domain'
import { buildPopWords } from './pop-lyric-timing'
import { groupLyricBreakUnits } from './lyric-line-break'

/**
 * 流光、倾诉、云阶共用的逐词数据与排版纯函数。
 * 排版只取决于歌词与种子（行起始时间），拖回同一句时几何不变，播放只推进各词的时间状态。
 */

export interface StyleWord {
  text: string
  /** 相对行起点的毫秒 */
  startMs: number
  endMs: number
}

/** 一句的逐词时序：有原生逐字时间就用，没有按字数估算（与跃字同一套规则）。 */
export function buildStyleWords(text: string, wordLine: WordLyricLine | undefined, dwellSec: number): StyleWord[] {
  const result: StyleWord[] = []
  let pending = ''
  for (const word of buildPopWords(text, wordLine, dwellSec)) {
    // 纯空白不单独成词（否则会单独发光、占一个换行单元）：并入前一个词，句首的留给下一个词。
    if (!word.text.trim()) {
      if (result.length) result[result.length - 1].text += word.text
      else pending += word.text
      continue
    }
    result.push({ text: pending + word.text, startMs: word.startMs, endMs: word.startMs + Math.max(1, word.durationMs) })
    pending = ''
  }
  return result
}

export type WordPhase = 'waiting' | 'active' | 'passed'

export interface WordState {
  phase: WordPhase
  /** 演唱进度 0..1（等待时 0，唱完后 1） */
  progress: number
  /** 距开唱的毫秒（等待时为负） */
  sinceStart: number
  /** 唱完后经过的毫秒（未唱完为 0） */
  sinceEnd: number
}

export function wordState(word: StyleWord, elapsedMs: number): WordState {
  const sinceStart = elapsedMs - word.startMs
  if (sinceStart < 0) return { phase: 'waiting', progress: 0, sinceStart, sinceEnd: 0 }
  if (elapsedMs < word.endMs) {
    return { phase: 'active', progress: Math.min(1, sinceStart / Math.max(1, word.endMs - word.startMs)), sinceStart, sinceEnd: 0 }
  }
  return { phase: 'passed', progress: 1, sinceStart, sinceEnd: elapsedMs - word.endMs }
}

/** 文本 → 数值种子（FNV-1a），用来让同一首歌的构图固定。 */
export function seedFromText(text: string): number {
  let hash = 2166136261
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619)
  return (hash >>> 0) / 1000
}

/** 可复现的伪随机数 [0, 1)：同一种子永远给出同一串数。 */
export function seededRandom(seed: number): () => number {
  let value = (Math.imul(Math.round(seed * 1000) | 0, 2654435761) ^ 0x9e3779b9) >>> 0 || 1
  return () => {
    value ^= value << 13
    value ^= value >>> 17
    value ^= value << 5
    return (value >>> 0) / 0x100000000
  }
}

const visibleChars = (text: string) => Array.from(text.replace(/\s+/g, '')).length

/**
 * 按换行单元（词组、标点粘连）把词分成 rowCount 行，各行字数尽量均衡。
 * 只在单元之间断开，不拆词组；单元数不足时行数相应减少。返回每行包含的词下标。
 */
export function splitRows(tokens: readonly string[], rowCount: number): number[][] {
  const units = groupLyricBreakUnits(tokens)
  if (!units.length) return []
  const rows = Math.max(1, Math.min(Math.round(rowCount), units.length))
  const weights = units.map(unit => Math.max(1, unit.reduce((n, i) => n + visibleChars(tokens[i]), 0)))
  const total = weights.reduce((a, b) => a + b, 0)
  const result: number[][] = []
  let unitIndex = 0
  let consumed = 0
  for (let row = 0; row < rows; row++) {
    const remainingRows = rows - row
    const target = (total - consumed) / remainingRows
    const current: number[] = []
    let size = 0
    // 每行至少一个单元，并给后面的行各留一个单元。
    while (unitIndex < units.length - (remainingRows - 1)) {
      const weight = weights[unitIndex]
      if (current.length && size + weight / 2 > target) break
      current.push(...units[unitIndex])
      size += weight
      unitIndex++
    }
    consumed += size
    result.push(current)
  }
  return result.filter(row => row.length)
}

// ---------- 流光：整句松散散布 ----------

export interface LuminousPose {
  /** 位移（em） */
  x: number
  y: number
  /** 倾角（度） */
  rotate: number
  /** 呼吸漂移的相位 */
  phase: number
}

/** 每个词一个固定姿态：散布幅度 spread 0..2，长句收敛，避免整行散成一片。 */
export function luminousLayout(words: readonly StyleWord[], seed: number, options: { spread: number; rotation: boolean }): LuminousPose[] {
  const random = seededRandom(seed)
  const density = Math.min(1, 10 / Math.max(1, words.length))
  const spread = Math.max(0, Math.min(2, options.spread)) * (0.55 + 0.45 * density)
  return words.map(() => ({
    x: (random() - 0.5) * 0.36 * spread,
    y: (random() - 0.5) * 0.9 * spread,
    rotate: options.rotation ? (random() - 0.5) * 14 * spread : 0,
    phase: random() * Math.PI * 2,
  }))
}

// ---------- 倾诉：1–4 行，正体与斜体错落 ----------

export interface TiltRow {
  words: number[]
  italic: boolean
}

/**
 * split 0..1：长句拆成多行的倾向；tilt 0..1：每行用斜体错落的概率。
 * 两行以上时保证至少一行正体、一行斜体，形成上下对比。
 */
export function tiltLayout(words: readonly StyleWord[], seed: number, options: { split: number; tilt: number }): TiltRow[] {
  const random = seededRandom(seed + 7)
  const chars = words.reduce((n, word) => n + visibleChars(word.text), 0)
  const split = Math.max(0, Math.min(1, options.split))
  const maxRows = chars > 24 ? 4 : chars > 15 ? 3 : chars > 6 ? 2 : 1
  // 长句至少两行，否则一整行过长难读；分行倾向为 0 时才保持单行。
  let rowCount = split > 0 && chars > 14 ? 2 : 1
  for (let row = rowCount + 1; row <= maxRows; row++) if (random() < split) rowCount = row
  const rows = splitRows(words.map(word => word.text), rowCount)
  const tilt = Math.max(0, Math.min(1, options.tilt))
  const italic = rows.map(() => random() < tilt)
  if (rows.length > 1 && tilt > 0 && tilt < 1) {
    if (italic.every(Boolean)) italic[0] = false
    else if (!italic.some(Boolean)) italic[italic.length - 1] = true
  }
  return rows.map((indices, i) => ({ words: indices, italic: italic[i] }))
}

// ---------- 云阶：按词组成行，阶梯错落 ----------

export interface PartitaRow {
  words: number[]
  /** 水平错位（em），正值向右 */
  offset: number
}

/**
 * 每行约 maxChars 个字，按词组断开（semantic 关闭时按字数硬切）；
 * 行与行左右交替、幅度随机，step 0..2 控制错落程度。
 */
export function partitaLayout(words: readonly StyleWord[], seed: number, options: { step: number; semantic: boolean; maxChars?: number }): PartitaRow[] {
  const random = seededRandom(seed + 13)
  const maxChars = options.maxChars ?? 5
  const latin = words.some(word => /[A-Za-z]{2,}/.test(word.text))
  const chars = words.reduce((n, word) => n + visibleChars(word.text), 0)
  // 最多 5 级台阶：超长句加宽每行而不是无限加行，避免缩到下限仍竖向溢出。
  const limit = Math.max(latin ? maxChars * 3 : maxChars, Math.ceil(chars / 5))
  const rowCount = Math.max(1, Math.min(5, Math.ceil(chars / limit)))
  let rows: number[][]
  if (options.semantic) {
    rows = splitRows(words.map(word => word.text), rowCount)
  } else {
    rows = []
    let current: number[] = []
    let size = 0
    words.forEach((word, i) => {
      const weight = visibleChars(word.text)
      if (current.length && size + weight > limit) { rows.push(current); current = []; size = 0 }
      current.push(i)
      size += weight
    })
    if (current.length) rows.push(current)
  }
  const step = Math.max(0, Math.min(2, options.step))
  let side = random() < 0.5 ? -1 : 1
  return rows.map((indices, i) => {
    if (i > 0) side = -side
    const offset = rows.length === 1 ? 0 : side * (0.6 + random() * 1.4) * step
    return { words: indices, offset }
  })
}
