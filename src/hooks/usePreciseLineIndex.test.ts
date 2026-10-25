import { describe, expect, it } from 'vitest'
import { lyricSwitchTimes } from './usePreciseLineIndex'

const lines = [{ time: 10, text: '甲乙' }, { time: 12, text: '丙丁' }, { time: 20, text: '戊' }]

describe('跃字换句时机', () => {
  it('上一句尾字唱完后才提前登场，最多提前 0.2 秒', () => {
    const switches = lyricSwitchTimes(lines, [
      { time: 10, durationMs: 1950, words: [{ text: '甲', startMs: 0, durationMs: 900 }, { text: '乙', startMs: 900, durationMs: 1050 }] },
      { time: 12, durationMs: 2000, words: [{ text: '丙', startMs: 0, durationMs: 1000 }, { text: '丁', startMs: 1000, durationMs: 1000 }] },
    ])
    expect(switches[0].time).toBe(10)
    // 上一句尾字唱到 11.95，只有 0.05 秒空隙
    expect(switches[1].time).toBeCloseTo(11.95)
    // 上一句 14 秒唱完，空隙很长，也只提前 0.2 秒
    expect(switches[2].time).toBeCloseTo(19.8)
  })

  it('没有可信逐字时序时不提前', () => {
    const switches = lyricSwitchTimes(lines, [{ time: 10, durationMs: 0, words: [{ text: '甲乙', startMs: 0 }] }, undefined])
    expect(switches.map(line => line.time)).toEqual([10, 12, 20])
  })
})
