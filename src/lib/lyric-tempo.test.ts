import { describe, expect, it } from 'vitest'
import { fitLyricTransition, lyricLineDwellSec, lyricLineInstantFill, lyricLineTempo } from './lyric-tempo'

const lines = [
  { time: 10, text: 'a' },
  { time: 13, text: 'b' },
  { time: 13.8, text: 'c' },
  { time: 14, text: 'd' }
]

describe('lyric-tempo', () => {
  it('停留时长取到下一句开始，末句为无限长', () => {
    expect(lyricLineDwellSec(lines, 0)).toBe(3)
    expect(lyricLineDwellSec(lines, 1)).toBeCloseTo(0.8)
    expect(lyricLineDwellSec(lines, 3)).toBe(Infinity)
    expect(lyricLineDwellSec(lines, -1)).toBe(Infinity)
    expect(lyricLineDwellSec([{ time: 5, text: 'x' }, { time: 4, text: 'y' }], 0)).toBe(Infinity)
  })

  it('按停留时长分三档', () => {
    expect(lyricLineTempo(Infinity)).toBe('normal')
    expect(lyricLineTempo(1.2)).toBe('normal')
    expect(lyricLineTempo(0.8)).toBe('short')
    expect(lyricLineTempo(0.2)).toBe('micro')
  })

  it('正常句保持原过渡，短句压进停留时长，极短句近乎硬切', () => {
    expect(fitLyricTransition(0.72, 3)).toBe(0.72)
    expect(fitLyricTransition(0.72, 0.8)).toBeCloseTo(0.48)
    expect(fitLyricTransition(0.3, 0.8)).toBe(0.3)
    expect(fitLyricTransition(0.72, 0.36)).toBeCloseTo(0.216)
    expect(fitLyricTransition(0.72, 0.2)).toBe(0.06)
  })

  it('只有极短句整句直接点亮', () => {
    expect(lyricLineInstantFill(0.2)).toBe(true)
    expect(lyricLineInstantFill(0.8)).toBe(false)
  })
})
