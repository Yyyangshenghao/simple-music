import { groupLyricBreakUnits } from './lyric-line-break'
import type { PopWord } from './pop-lyric-timing'

/**
 * 跃字排版：按语义边界拼成有主次的文字海报，实测宽度决定分行与缩放。
 * 最终分行由这里决定（行内不再交给 CSS 折行），同一句在同一窗口里构图固定。
 */

export interface PopUnit {
  /** 词序号（指向 PopWord 数组） */
  words: number[]
  /** 字面权重（汉字约为 1），不能把一个英文词误当成一个字 */
  weight: number
  /** 之后是否为语义停顿（空格、标点或演唱间隙）：同一行里在这里留一段词组间距 */
  pause: boolean
  /** 在此处折行的偏好：标点 > 空格 > 演唱间隙 > 普通词界 */
  breakBonus: number
}

const PUNCTUATION_END = /[，。！？、；：,.!?;:…—]\s*$/u
/** 依附前文的单字（方位词、助词、语气词）：不该落在行首 */
const LEANS_BACK = new Set(Array.from('下上里中外前后边的地得了着过吧呢啊吗呀么嘛啦'))
/** 引出后文的单字（介词、连词）：不该留在行尾 */
const LEANS_FORWARD = new Set(Array.from('在把被让给从向往对跟和与同为将及或'))
/** 演唱间隙达到这个长度视为句内停顿 */
const PAUSE_GAP_MS = 260

/** 用大致字面宽度估算（未测量前的首帧与测试用），1 = 一个汉字宽。 */
export function popTextWeight(text: string): number {
  return Array.from(text).reduce((total, char) => total + (/\s/u.test(char) ? 0.3 : /[\p{Script=Latin}\p{Number}]/u.test(char) ? 0.56 : 1), 0)
}

/** 把逐字 token 归并成不可拆的词组单元，并标出单元之后的语义停顿。 */
export function buildPopUnits(words: readonly PopWord[]): PopUnit[] {
  const groups = groupLyricBreakUnits(words.map(word => word.text))
  const single = (group: number[] | undefined, set: Set<string>) => {
    const text = group?.map(i => words[i].text).join('').trim() ?? ''
    return Array.from(text).length === 1 && set.has(text)
  }
  return groups.map((group, index) => {
    const weight = popTextWeight(group.map(i => words[i].text).join(''))
    const last = words[group.at(-1)!]
    const nextGroup = groups[index + 1]
    if (!nextGroup) return { words: group, weight, pause: false, breakBonus: 0 }
    const next = words[nextGroup[0]]
    const gap = next.startMs - last.startMs - last.durationMs
    const punct = PUNCTUATION_END.test(last.text)
    const space = /\s$/u.test(last.text) && !/[\p{Script=Latin}\p{Number}]\s*$/u.test(last.text)
    const latinSpace = /\s$/u.test(last.text)
    const pause = punct || space || gap >= PAUSE_GAP_MS
    let breakBonus = punct ? 3 : space ? 2.4 : gap >= PAUSE_GAP_MS ? 1.2 : latinSpace ? 0.6 : 0
    // 在这里断会让“夜空 / 下”“在 / 风里”这类单字脱离它依附的词组。
    if (!punct && !space && (single(nextGroup, LEANS_BACK) || single(group, LEANS_FORWARD))) breakBonus -= 4
    return { words: group, weight, pause, breakBonus }
  })
}

export interface PopRowPlan {
  /** 每行包含的单元序号 */
  rows: number[][]
  /** 字号再缩的系数（≤1）：最多行数仍放不下最宽一行时才缩 */
  fit: number
}

export type PopReveal = 'fold' | 'sweep' | 'rise'

/** 短句聚成一击，中句两组、长句三组；短促连句优先一眼读完。 */
export function popScene(words: readonly PopWord[], dwellSec: number): { rows: number; reveal: PopReveal } {
  const weight = popTextWeight(words.map(word => word.text).join(''))
  const rows = weight <= 6 || dwellSec < 1.2 ? 1 : weight > 22 ? 3 : 2
  return { rows, reveal: rows === 1 ? 'fold' : rows === 2 ? 'sweep' : 'rise' }
}

/** 每句姿态固定：重点词组放大，其余收小；左右交替而不形成等距台阶。 */
export function popPhrasePose(count: number, index: number, seed: number) {
  const direction = Math.floor(seed / 1000) % 2 ? 1 : -1
  const accent = index === count - 1
  return {
    accent,
    scale: count === 1 ? 1.12 : accent ? 1.12 : 0.82,
    align: count === 1 ? 'center' as const : (index + (direction > 0 ? 0 : 1)) % 2 ? 'end' as const : 'start' as const,
    angle: count === 1 ? direction * 1.2 : direction * (index % 2 ? 1.4 : -1.8),
  }
}

/**
 * 按真实宽度分行。widths 为各单元宽、gap 为语义停顿处的词组间距（同单位），maxWidth 为可用宽。
 * 先求能放下的最少行数；同样行数里优先在语义停顿处断、两行长度接近、不留一两个字的孤尾。
 */
export function planPopRows(units: readonly PopUnit[], widths: readonly number[], gap: number, maxWidth: number, maxRows = 3, minRows = 1): PopRowPlan {
  const n = units.length
  if (!n) return { rows: [], fit: 1 }
  const rowWidth = (from: number, to: number) => {
    let width = 0
    for (let i = from; i < to; i++) width += widths[i] + (i < to - 1 && units[i].pause ? gap : 0)
    return width
  }
  const unitChars = (from: number, to: number) => {
    let chars = 0
    for (let i = from; i < to; i++) chars += units[i].weight
    return chars
  }
  const total = rowWidth(0, n)
  let best: { rows: number[][]; widest: number; score: number } | null = null
  for (let count = Math.min(minRows, maxRows, n); count <= Math.min(maxRows, n); count++) {
    const candidates: number[][] = []
    const walk = (start: number, left: number, cuts: number[]) => {
      if (left === 1) { candidates.push(cuts); return }
      for (let end = start + 1; end <= n - left + 1; end++) walk(end, left - 1, [...cuts, end])
    }
    walk(0, count, [])
    let local: { rows: number[][]; widest: number; score: number } | null = null
    for (const cuts of candidates) {
      const bounds = [0, ...cuts, n]
      const rowWidths = bounds.slice(1).map((end, i) => rowWidth(bounds[i], end))
      const widest = Math.max(...rowWidths)
      let score = widest / Math.max(1, maxWidth)
      for (const cut of cuts) score -= units[cut - 1].breakBonus * 0.08
      // 孤尾：末行只剩一两个字，或明显短于其余行。
      const lastChars = unitChars(bounds[count - 1], n)
      if (count > 1 && (lastChars <= 2 || rowWidths[count - 1] < widest * 0.34)) score += 0.6
      // 各行长短接近，上短下长的构图优先于上长下短。
      if (count > 1) {
        const shortest = Math.min(...rowWidths)
        score += (1 - shortest / widest) * 0.3
        if (rowWidths[0] > rowWidths[count - 1] * 1.35) score += 0.05
      }
      if (!local || score < local.score) local = { rows: bounds.slice(1).map((end, i) => range(bounds[i], end)), widest, score }
    }
    if (!local) continue
    if (local.widest <= maxWidth) return { rows: local.rows, fit: 1 }
    if (!best || local.widest < best.widest) best = local
  }
  // 最多行数仍放不下（超长英文单词或极长句）：选最窄的分法再整体缩字号。
  const chosen = best ?? { rows: [range(0, n)], widest: total, score: 0 }
  return { rows: chosen.rows, fit: Math.max(0.3, maxWidth / Math.max(1, chosen.widest)) }
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from }, (_, i) => from + i)
}

/** 未测量前的首帧分行：按估算字宽、以 em 为单位（maxEm 为一行大约能放的汉字数）。 */
export function estimatePopRows(words: readonly PopWord[], maxEm = 13, minRows = 1): PopRowPlan & { units: PopUnit[] } {
  const units = buildPopUnits(words)
  const widths = units.map(unit => popTextWeight(unit.words.map(i => words[i].text).join('')))
  return { units, ...planPopRows(units, widths, 0.45, maxEm, 3, minRows) }
}
