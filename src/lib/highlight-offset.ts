import type { LyricLine } from '../types/domain'

export interface HighlightRange {
  startSec: number
  endSec: number
}

const DEFAULT_CLIP_SEC = 20

/** 取整曲时长 45% 居中的 clipSec 窗口作回退。 */
function fallbackRange(durationMs: number, clipSec: number): HighlightRange {
  const durSec = durationMs > 0 ? durationMs / 1000 : 0
  if (durSec <= 0) return { startSec: 0, endSec: 0 }
  const clip = Math.min(clipSec, durSec)
  const start = Math.max(0, durSec * 0.45 - clip / 2)
  const clamped = Math.min(start, Math.max(0, durSec - clip))
  return { startSec: clamped, endSec: clamped + clip }
}

/**
 * 由 LRC 行密度估计高潮段:取 clipSec 滑窗内歌词行数最多的窗口作副歌。
 * 行数不足(<8)或无时长时回退到时长 45% 居中窗口。窗起点用行时间戳而非等分网格,避免漏检。
 */
export function computeHighlightOffset(
  lines: LyricLine[],
  durationMs: number,
  clipSec = DEFAULT_CLIP_SEC,
): HighlightRange {
  if (!lines || lines.length < 8) return fallbackRange(durationMs, clipSec)
  const durSec = durationMs > 0 ? durationMs / 1000 : 0
  if (durSec <= 0) return fallbackRange(durationMs, clipSec)
  const clip = Math.min(clipSec, durSec)
  const ts = lines.map((l) => l.time).filter((t) => typeof t === 'number' && t >= 0).sort((a, b) => a - b)
  if (ts.length < 8) return fallbackRange(durationMs, clipSec)

  let bestStart = ts[0]
  let bestScore = -1
  for (let i = 0; i < ts.length; i++) {
    const wStart = ts[i]
    const wEnd = wStart + clip
    if (wEnd > durSec + 0.5) continue
    let count = 0
    for (let j = i; j < ts.length; j++) {
      if (ts[j] <= wEnd) count++
      else break
    }
    if (count > bestScore) {
      bestScore = count
      bestStart = wStart
    }
  }
  const start = Math.min(bestStart, Math.max(0, durSec - clip))
  return { startSec: start, endSec: start + clip }
}