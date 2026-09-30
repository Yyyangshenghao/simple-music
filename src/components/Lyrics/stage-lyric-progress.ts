import type { WordLyricLine, WordToken } from '../../types/domain'
import { hasWordTiming } from '../../lib/word-highlight-timeline'

export function normalizeStageLyricText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

export function hasPreciseWordTiming(line: WordLyricLine | undefined): boolean {
  return !!line && Number.isFinite(line.time) && hasWordTiming(line.words)
}

/** 在创建纹理时用绘制字体测量前缀，帧更新只读取边界，不再测量或按字数均分。 */
export function measureWordBoundaries(words: WordToken[], measure: (text: string) => number): number[] {
  const text = normalizeStageLyricText(words.map((word) => word.text).join(''))
  const width = measure(text)
  if (width <= 0) return []
  let prefix = ''
  return [0, ...words.map((word) => {
    prefix += word.text
    const end = Math.min(text.length, prefix.replace(/\s+/g, ' ').trimStart().length)
    return Math.min(1, Math.max(0, measure(text.slice(0, end)) / width))
  })]
}

/** 每个 texel 存一个字的字面起止及原生秒级时序，仅创建纹理时生成。 */
export function stageWordTimeline(line: WordLyricLine | undefined, boundaries: number[]) {
  if (!hasPreciseWordTiming(line) || !line || boundaries.length !== line.words.length + 1) return new Float32Array(0)
  const data = new Float32Array(line.words.length * 4)
  line.words.forEach((word, index) => {
    data.set([boundaries[index], boundaries[index + 1], word.startMs / 1000, word.durationMs! / 1000], index * 4)
  })
  return data
}

/** 装饰线的最远进度；实际字面由 shader 独立采样每个字，支持重叠时序。 */
export function stageLyricProgress(now: number, line: WordLyricLine | undefined, boundaries: number[]): number {
  if (!hasPreciseWordTiming(line) || !line || boundaries.length !== line.words.length + 1) return 1
  const nowMs = now * 1000 - line.time * 1000
  let progress = 0
  for (let index = 0; index < line.words.length; index++) {
    const word = line.words[index]
    if (nowMs < word.startMs) continue
    const duration = word.durationMs!
    const local = duration <= 0 ? 1 : Math.min(1, (nowMs - word.startMs) / duration)
    progress = Math.max(progress, boundaries[index] + (boundaries[index + 1] - boundaries[index]) * local)
  }
  return progress
}
