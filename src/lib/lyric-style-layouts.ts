import type { WordLyricLine } from '../types/domain'
import { buildPopWords } from './pop-lyric-timing'
import { groupLyricBreakUnits } from './lyric-line-break'

/**
 * 云阶、拼版等动态样式共用的逐词数据与排版纯函数。
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

// ---------- 云阶：词组成行、台阶错落 ----------

export interface PartitaRow {
  words: number[]
  /** 水平错位（em），正值向右 */
  offset: number
}

/**
 * 每行约 maxChars 个字，按词组断开（semantic 关闭时按字数硬切）；
 * 行与行左右交替、幅度随机，step 0..2 控制错落程度。
 */
export function partitaLayout(words: readonly StyleWord[], seed: number, options: { step: number; semantic: boolean; maxChars?: number; rows?: number }): PartitaRow[] {
  const random = seededRandom(seed + 13)
  const maxChars = options.maxChars ?? 5
  const latin = words.some(word => /[A-Za-z]{2,}/.test(word.text))
  const chars = words.reduce((n, word) => n + visibleChars(word.text), 0)
  // 最多 5 级台阶：超长句加宽每行而不是无限加行，避免缩到下限仍竖向溢出。
  // 给了 rows（按舞台尺寸算出的级数）就按它分，仍只在词组之间断开。
  const limit = options.rows ? Math.ceil(chars / options.rows) : Math.max(latin ? maxChars * 3 : maxChars, Math.ceil(chars / 5))
  const rowCount = Math.max(1, Math.min(5, options.rows ?? Math.ceil(chars / limit)))
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

/**
 * 云阶按舞台的实际宽高决定台阶级数。默认沿用每级约 5 字的自然台阶（与不给 rows 时的分法相同）：
 * 级数一变，词组的断点也跟着变，自然台阶的断点最贴近语义。只有舞台明显放不下、
 * 自然台阶会被缩到最佳分法的八成以下时（很矮或很窄的窗口），才改用让字最大的级数。8 字以上至少两级，最多 5 级。
 * stage 以 em 计（舞台像素 ÷ 基准字号）：每行宽约 每行字数 × 字宽 + 两侧错位留白，每级高约 1.36em（行高加间距与引导线）。
 */
export function partitaRowsForStage(words: readonly StyleWord[], stage: { width: number; height: number }): number {
  const latin = words.some(word => /[A-Za-z]{2,}/.test(word.text))
  const chars = words.reduce((n, word) => n + visibleChars(word.text), 0)
  if (!chars) return 1
  const limit = Math.max(latin ? 15 : 5, Math.ceil(chars / 5))
  const natural = Math.max(1, Math.min(5, Math.ceil(chars / limit)))
  if (!(stage.width > 0) || !(stage.height > 0)) return natural
  const charEm = latin ? 0.56 : 1
  const minRows = Math.min(natural, chars >= 8 ? 2 : 1)
  const scaleOf = (rows: number) => {
    const widthEm = Math.ceil(chars / rows) * charEm + (rows > 1 ? 3.4 : 0.6)
    return Math.min(1, stage.width / widthEm, stage.height / (rows * 1.36))
  }
  const candidates = Array.from({ length: Math.max(1, Math.min(5, chars) - minRows + 1) }, (_, i) => ({ rows: minRows + i, scale: scaleOf(minRows + i) }))
  const top = Math.max(...candidates.map(c => c.scale))
  if (scaleOf(natural) >= top * 0.8) return natural
  return candidates.filter(c => c.scale >= top * 0.96).sort((a, b) => Math.abs(a.rows - natural) - Math.abs(b.rows - natural))[0].rows
}
