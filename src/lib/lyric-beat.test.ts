import { describe, it, expect } from 'vitest'
import { createOnsetDetector } from './lyric-beat'

const spectrum = (level: number) => new Uint8Array(64).fill(level)

describe('低频起音检测', () => {
  it('稳定能量不触发，突增触发一次并产生衰减脉冲', () => {
    const detector = createOnsetDetector()
    let now = 0
    for (let i = 0; i < 60; i++) expect(detector.update(spectrum(60), now += 16).onset).toBe(false)
    const hit = detector.update(spectrum(220), now += 16)
    expect(hit.onset).toBe(true)
    expect(hit.pulse).toBeCloseTo(1)
    // 不应期内持续高能量不重复触发；脉冲随时间衰减。
    const held = detector.update(spectrum(220), now += 16)
    expect(held.onset).toBe(false)
    expect(held.pulse).toBeLessThan(hit.pulse)
    expect(detector.update(spectrum(60), now += 600).pulse).toBeLessThan(0.1)
  })

  it('规律的鼓点按拍触发', () => {
    const detector = createOnsetDetector()
    let onsets = 0
    for (let frame = 0, now = 0; frame < 300; frame++, now += 16) {
      const beat = frame % 30 === 0
      if (detector.update(spectrum(beat ? 230 : 50), now).onset) onsets++
    }
    expect(onsets).toBeGreaterThanOrEqual(8)
    expect(onsets).toBeLessThanOrEqual(10)
  })

  it('静音与空频谱不触发，重置后重新适应', () => {
    const detector = createOnsetDetector()
    expect(detector.update(new Uint8Array(), 0)).toEqual({ energy: 0, pulse: 0, onset: false })
    for (let now = 0; now < 1000; now += 16) expect(detector.update(spectrum(2), now).onset).toBe(false)
    detector.reset()
    expect(detector.update(spectrum(200), 2000).onset).toBe(false)
  })
})
