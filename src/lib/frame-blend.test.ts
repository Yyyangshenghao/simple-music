import { describe, expect, it } from 'vitest'
import { frameBlend } from './frame-blend'

describe('frameBlend', () => {
  it('30/60/120 帧在相同时间抵达相同位置', () => {
    const advance = (fps: number) => {
      let value = 0
      for (let i = 0; i < fps / 2; i++) value += (1 - value) * frameBlend(0.08, 1 / fps)
      return value
    }
    expect(advance(30)).toBeCloseTo(advance(60), 12)
    expect(advance(120)).toBeCloseTo(advance(60), 12)
  })

  it('不因单帧停顿过冲，零时间不推进', () => {
    expect(frameBlend(0.16, 0)).toBe(0)
    expect(frameBlend(0.16, 0.1)).toBeGreaterThan(0.16)
    expect(frameBlend(0.16, 0.1)).toBeLessThan(1)
    expect(frameBlend(0.16, 1 / 60)).toBeCloseTo(0.16)
  })
})
