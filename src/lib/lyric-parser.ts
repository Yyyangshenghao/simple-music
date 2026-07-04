import type { LyricLine, WordToken, WordLyricLine } from '../types/domain'

const TIME_TAG = /\[(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?\]/g

function tagToSeconds(mm: string, ss: string, frac?: string): number {
  const minutes = parseInt(mm, 10) || 0
  const seconds = parseInt(ss, 10) || 0
  let fraction = 0
  if (frac) fraction = (parseInt(frac, 10) || 0) / Math.pow(10, frac.length)
  return minutes * 60 + seconds + fraction
}

/**
 * 解析 LRC 文本为按时间排序的歌词行。
 * - 一行可含多个时间标签，会展开为多行（移植自原 parseLyricText）。
 * - 无时间标签的行（含 [ar:]/[ti:] 等元信息）被忽略。
 */
export function parseLrc(text: string): LyricLine[] {
  const lines: LyricLine[] = []
  for (const raw of String(text || '').split(/\r?\n/)) {
    const times: number[] = []
    let m: RegExpExecArray | null
    TIME_TAG.lastIndex = 0
    while ((m = TIME_TAG.exec(raw))) times.push(tagToSeconds(m[1], m[2], m[3]))
    if (!times.length) continue
    const txt = raw.replace(TIME_TAG, '').trim()
    if (!txt) continue
    for (const t of times) lines.push({ time: t, text: txt })
  }
  lines.sort((a, b) => a.time - b.time)
  return lines
}

/**
 * 将翻译行按时间对齐到主歌词行。返回与 main 等长的数组，
 * 每项为时间最接近（容差 0.3s）的翻译文本，无匹配则空字符串。
 */
export function alignTranslation(main: LyricLine[], translation: LyricLine[]): LyricLine[] {
  const tol = 0.3
  return main.map((line) => {
    let best: LyricLine | null = null
    let bestDiff = Infinity
    for (const tr of translation) {
      const diff = Math.abs(tr.time - line.time)
      if (diff < bestDiff) {
        bestDiff = diff
        best = tr
      }
    }
    return { time: line.time, text: best && bestDiff <= tol ? best.text : '' }
  })
}

/**
 * 解析网易 YRC（逐字歌词）格式。
 * 歌词行格式：[行起始Ms,行时长Ms](字绝对起始Ms,字时长Ms,0)字(…)字…
 *   - 字的起始时间是歌曲内绝对毫秒，这里转换为相对行起始的偏移；
 *   - token 可能是多字词（如英文单词），文本原样保留（含空格，用于排版）。
 * 开头若干行是 {"t":…,"c":[…]} 形式的 JSON 元信息（作词/作曲等），没有
 * [start,dur] 头，直接跳过。
 * 返回 WordLyricLine[]，按时间排序。
 */
export function parseYrc(text: string): WordLyricLine[] {
  if (!text) return []
  const lines: WordLyricLine[] = []
  const WORD_TOKEN = /\((\d+),(\d+),-?\d+\)([^(]*)/g
  for (const raw of String(text).split(/\r?\n/)) {
    const headerMatch = raw.match(/^\[(\d+),(\d+)\](.*)$/)
    if (!headerMatch) continue
    const lineStartMs = parseInt(headerMatch[1], 10)
    const durationMs = parseInt(headerMatch[2], 10)
    const words: WordToken[] = []
    let m: RegExpExecArray | null
    WORD_TOKEN.lastIndex = 0
    while ((m = WORD_TOKEN.exec(headerMatch[3]))) {
      const tx = m[3]
      if (!tx || !tx.trim()) continue
      words.push({
        text: tx,
        startMs: Math.max(0, parseInt(m[1], 10) - lineStartMs),
        durationMs: parseInt(m[2], 10),
      })
    }
    if (words.length) {
      lines.push({ time: lineStartMs / 1000, durationMs, words })
    }
  }
  lines.sort((a, b) => a.time - b.time)
  return lines
}

/**
 * 当没有 YRC 数据时，用 LRC 行列表估算逐字时序（均分行时长到每个字符）。
 * lines 是已排序的 LyricLine[]。
 */
export function estimateWordTiming(lines: LyricLine[]): WordLyricLine[] {
  return lines.map((line, i) => {
    const nextTime = lines[i + 1]?.time ?? line.time + 4
    const durationMs = Math.max(500, (nextTime - line.time) * 1000)
    const chars = [...line.text]
    if (!chars.length) return { time: line.time, durationMs, words: [] }
    const perChar = durationMs / chars.length
    const words: WordToken[] = chars.map((ch, j) => ({
      text: ch,
      startMs: Math.round(j * perChar),
    }))
    return { time: line.time, durationMs, words }
  })
}
