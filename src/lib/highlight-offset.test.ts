import { describe, it, expect } from 'vitest'
import { computeHighlightOffset } from './highlight-offset'
import type { LyricLine } from '../types/domain'

function linesAt(times: number[]): LyricLine[] {
  return times.map((t) => ({ time: t, text: `line-${t}` }))
}

describe('computeHighlightOffset', () => {
  it('行数不足时回退到时长 45% 居中窗口', () => {
    const r = computeHighlightOffset([], 200_000, 20)
    // 200s * 0.45 = 90, 居中: start = 90 - 10 = 80
    expect(r.startSec).toBe(80)
    expect(r.endSec - r.startSec).toBe(20)
  })

  it('选中行密度最高的一段', () => {
    // 0-10s 散落 3 行,40-50s 密集 8 行 → 应落在 40 附近
    const sparse = linesAt([1, 4, 8])
    const dense = linesAt([40, 41, 42, 43, 44, 45, 46, 47])
    const r = computeHighlightOffset([...sparse, ...dense], 100_000, 20)
    expect(r.startSec).toBeGreaterThanOrEqual(40)
    expect(r.startSec).toBeLessThanOrEqual(47)
  })

  it('钳制到 [0, duration]', () => {
    const r = computeHighlightOffset(linesAt([1, 2, 3, 4, 5, 6, 7, 8]), 10_000, 20)
    // 曲长 10s < clip 20s:start=0, end=10
    expect(r.startSec).toBe(0)
    expect(r.endSec).toBe(10)
  })

  it('duration 无效时回退默认 0', () => {
    const r = computeHighlightOffset(linesAt([1, 2, 3]), 0, 20)
    expect(r.startSec).toBe(0)
    expect(r.endSec).toBeGreaterThanOrEqual(0)
  })
})