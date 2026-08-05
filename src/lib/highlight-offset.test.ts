import { describe, it, expect } from 'vitest'
import { computeHighlightOffset, preferredHighlightDuration } from './highlight-offset'
import type { LyricLine } from '../types/domain'

function linesAt(times: number[]): LyricLine[] {
  return times.map((t) => ({ time: t, text: `line-${t}` }))
}

describe('computeHighlightOffset', () => {
  it('按曲长与歌词节奏弹性选择片段长度，而非固定 30 秒', () => {
    expect(preferredHighlightDuration([], 110_000)).toBe(25)
    expect(preferredHighlightDuration([], 240_000)).toBe(36)
    expect(preferredHighlightDuration(linesAt([10, 12, 14, 16, 18]), 180_000)).toBe(33)
  })

  it('无歌词时回退到歌曲结构上更常见的后半段', () => {
    const r = computeHighlightOffset([], 200_000, 20)
    expect(r.startSec).toBeCloseTo(106)
    expect(r.endSec - r.startSec).toBe(20)
    expect(r.kind).toBe('structure')
  })

  it('优先选重复副歌，而不是更密集的主歌', () => {
    const verse = Array.from({ length: 24 }, (_, i) => ({ time: 18 + i * 1.4, text: `独特主歌第${i}句` }))
    const refrain = ['奔向同一片海', '风把名字吹来', '这一刻不要离开', '我们仍在等待']
    const first = refrain.map((text, i) => ({ time: 70 + i * 4, text }))
    const second = refrain.map((text, i) => ({ time: 128 + i * 4, text }))
    const r = computeHighlightOffset([...verse, ...first, ...second], 190_000, 30)
    expect(r.startSec).toBeGreaterThanOrEqual(120)
    expect(r.startSec).toBeLessThan(132)
    expect(r.kind).toBe('refrain')
  })

  it('忽略标点与空格差异识别重复歌词', () => {
    const lines: LyricLine[] = [
      { time: 42, text: '如果，我们还能相见！' },
      { time: 47, text: '就别再说再见' },
      { time: 108, text: '如果 我们还能相见' },
      { time: 113, text: '就别再说，再见。' },
    ]
    const r = computeHighlightOffset(lines, 160_000, 30)
    expect(r.kind).toBe('refrain')
    expect(r.startSec).toBeGreaterThan(100)
  })

  it('能识别多次重复的短句 hook', () => {
    const lines: LyricLine[] = [
      { time: 36, text: '想你' },
      { time: 74, text: '想你' },
      { time: 118, text: '想你' },
    ]
    const r = computeHighlightOffset(lines, 160_000, 30)
    expect(r.kind).toBe('refrain')
    expect(r.startSec).toBeGreaterThan(65)
  })

  it('没有重复段时对齐到目标附近的歌词行', () => {
    const r = computeHighlightOffset(linesAt([20, 50, 82, 109, 140]), 200_000, 30)
    expect(r.startSec).toBe(107.5)
    expect(r.kind).toBe('structure')
  })

  it('结构回退会选择目标点前方更近的歌词，而不是落进伴奏空窗', () => {
    const r = computeHighlightOffset(linesAt([30, 90, 140]), 200_000, 30)
    expect(r.startSec).toBe(88.5)
    expect(r.kind).toBe('structure')
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
