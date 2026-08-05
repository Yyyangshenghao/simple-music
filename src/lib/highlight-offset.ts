import type { LyricLine } from '../types/domain'

export interface HighlightRange {
  startSec: number
  endSec: number
  kind: 'refrain' | 'structure'
}

const MIN_CLIP_SEC = 22
const MAX_CLIP_SEC = 38
const TARGET_CENTER_RATIO = 0.58
const REFRAIN_CENTER_RATIO = 0.68
const PRE_ROLL_SEC = 1.5

interface PreparedLine extends LyricLine {
  normalized: string
}

function clampRange(startSec: number, durationSec: number, clipSec: number, kind: HighlightRange['kind']): HighlightRange {
  const clip = Math.min(Math.max(0, clipSec), durationSec)
  const start = Math.max(0, Math.min(startSec, durationSec - clip))
  return { startSec: start, endSec: start + clip, kind }
}

function normalizeLyric(text: string): string {
  return text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

function isMetadata(text: string): boolean {
  return /^(作词|作曲|编曲|制作人|演唱|词|曲|composer|lyricist|arranger)[:：]/i.test(text.trim())
}

function prepareLines(lines: LyricLine[], durationSec: number): PreparedLine[] {
  return lines
    .filter((line) => Number.isFinite(line.time) && line.time >= 0 && line.time < durationSec && !isMetadata(line.text))
    .map((line) => ({ ...line, normalized: normalizeLyric(line.text) }))
    .filter((line) => line.normalized.length >= 2)
    .sort((a, b) => a.time - b.time)
}

function structuralRange(lines: PreparedLine[], durationSec: number, clipSec: number): HighlightRange {
  const clip = Math.min(clipSec, durationSec)
  const targetStart = Math.max(0, durationSec * TARGET_CENTER_RATIO - clip / 2)
  const nearby = lines
    .filter((line) => Math.abs(line.time - targetStart) <= clip * 0.5)
    .reduce<PreparedLine | null>((closest, line) => (
      !closest || Math.abs(line.time - targetStart) < Math.abs(closest.time - targetStart) ? line : closest
    ), null)
  return clampRange(nearby ? nearby.time - PRE_ROLL_SEC : targetStart, durationSec, clip, 'structure')
}

/**
 * 刷歌片段不固定为 30 秒：短歌收紧、长歌放宽，并用歌词行间隔微调，
 * 尽量让一句/一组副歌不会在最突兀的位置被截断。
 */
export function preferredHighlightDuration(lines: LyricLine[], durationMs: number): number {
  const durationSec = durationMs > 0 ? durationMs / 1000 : 0
  if (durationSec <= 0) return 0
  const prepared = prepareLines(lines ?? [], durationSec)
  const gaps = prepared.slice(1).map((line, index) => line.time - prepared[index].time).filter((gap) => gap > 0)
  const sortedGaps = [...gaps].sort((a, b) => a - b)
  const medianGap = sortedGaps.length ? sortedGaps[Math.floor(sortedGaps.length / 2)] : 0
  const durationBased = 24 + (durationSec - 100) * 0.085
  const cadenceAdjustment = medianGap && medianGap <= 2.5 ? 2 : medianGap >= 6 ? -2 : 0
  return Math.min(durationSec, Math.max(MIN_CLIP_SEC, Math.min(MAX_CLIP_SEC, Math.round(durationBased + cadenceAdjustment))))
}

function recurringLyrics(lines: PreparedLine[], clipSec: number): Set<string> {
  const occurrences = new Map<string, number[]>()
  for (const line of lines) {
    const times = occurrences.get(line.normalized) ?? []
    times.push(line.time)
    occurrences.set(line.normalized, times)
  }

  const recurring = new Set<string>()
  for (const [text, times] of occurrences) {
    if (times.some((time, i) => times.slice(i + 1).some((later) => later - time >= clipSec * 0.7))) {
      recurring.add(text)
    }
  }
  return recurring
}

/**
 * 优先寻找在歌曲不同位置重复出现的歌词簇（副歌最稳定的轻量代理）；找不到时按常见歌曲结构
 * 落在后半段，并对齐到附近歌词行。这里只使用已经拉取的歌词，不增加音频分析或服务端成本。
 */
export function computeHighlightOffset(
  lines: LyricLine[],
  durationMs: number,
  clipSec?: number,
): HighlightRange {
  const durationSec = durationMs > 0 ? durationMs / 1000 : 0
  if (durationSec <= 0) return { startSec: 0, endSec: 0, kind: 'structure' }

  const prepared = prepareLines(lines ?? [], durationSec)
  const clip = Math.min(Math.max(1, clipSec ?? preferredHighlightDuration(lines, durationMs)), durationSec)
  const recurring = recurringLyrics(prepared, clip)
  const singleRecurring = recurring.size === 1 ? [...recurring][0] : null
  const singleOccurrences = singleRecurring
    ? prepared.filter((line) => line.normalized === singleRecurring).length
    : 0
  // 单句 hook 也很常见：较长句重复两次即可，极短句需至少三次，降低“嗯/啊”等口头词误判。
  const strongSingle = !!singleRecurring && (singleRecurring.length >= 4 || singleOccurrences >= 3)
  if (recurring.size === 0 || (recurring.size === 1 && !strongSingle)) {
    return structuralRange(prepared, durationSec, clip)
  }

  let best: { start: number; score: number } | null = null
  for (const anchor of prepared) {
    if (!recurring.has(anchor.normalized)) continue
    const start = Math.max(0, Math.min(anchor.time - PRE_ROLL_SEC, durationSec - clip))
    const inWindow = prepared.filter((line) => line.time >= start && line.time <= start + clip)
    const repeated = new Set(inWindow.filter((line) => recurring.has(line.normalized)).map((line) => line.normalized))
    if (repeated.size < (strongSingle ? 1 : 2)) continue

    const centerRatio = (start + clip / 2) / durationSec
    const positionScore = Math.max(0, 1 - Math.abs(centerRatio - REFRAIN_CENTER_RATIO) / 0.45)
    const coverage = inWindow.length > 1
      ? Math.min(1, (inWindow[inWindow.length - 1].time - inWindow[0].time) / (clip * 0.55))
      : 0
    const score = repeated.size * 10 + Math.min(inWindow.length, 12) * 0.25 + positionScore * 4 + coverage * 2
    if (!best || score > best.score) best = { start, score }
  }

  return best
    ? clampRange(best.start, durationSec, clip, 'refrain')
    : structuralRange(prepared, durationSec, clip)
}
