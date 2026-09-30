import { describe, expect, it } from 'vitest'
import { AppleLyricClock } from './apple-lyric-clock'

describe('Apple 逐字歌词时钟', () => {
  it('在整秒采样间连续前进，重复采样不重置时钟', () => {
    const clock = new AppleLyricClock()
    clock.update(10, true, 180, 0)
    expect(clock.read(250)).toBeCloseTo(10.25)
    clock.update(10, true, 180, 250)
    expect(clock.read(750)).toBeCloseTo(10.75)
    clock.update(11, true, 180, 1100)
    expect(clock.read(1100)).toBeCloseTo(11.1)
    expect(clock.read(1200)).toBeCloseTo(11.2)
  })

  it('暂停及恢复的整秒确认不让已点亮文字倒退', () => {
    const clock = new AppleLyricClock()
    clock.update(30, true, 180, 0)
    clock.reset(clock.read(250), false, 180, 250)
    clock.update(30, false, 180, 500)
    clock.update(30, false, 180, 1000)
    expect(clock.read(1500)).toBe(30.25)
    clock.update(30, true, 180, 1500)
    expect(clock.read(1750)).toBe(30.5)
  })

  it('停止收到有效进度时最多推算 1.25 秒', () => {
    const clock = new AppleLyricClock()
    clock.update(10, true, 180, 0)
    clock.update(10, true, 180, 1000)
    expect(clock.read(10000)).toBe(11.25)
  })

  it('暂停冻结、拖动立即定位、恢复及新曲重置', () => {
    const clock = new AppleLyricClock()
    clock.update(10, true, 180, 0)
    clock.reset(clock.read(500), false, 180, 500)
    expect(clock.read(2000)).toBe(10.5)
    clock.reset(80, false, 180, 2000)
    expect(clock.read(2500)).toBe(80)
    clock.update(80, true, 180, 3000)
    expect(clock.read(3500)).toBe(80.5)
    clock.reset(0, false, 0, 3500)
    expect(clock.read(4000)).toBe(0)
  })

  it('不超过歌曲结束，明显位置偏差立即校准', () => {
    const clock = new AppleLyricClock()
    clock.update(179.5, true, 180, 0)
    expect(clock.read(1000)).toBe(180)
    clock.update(20, true, 180, 1000)
    expect(clock.read(1000)).toBe(20)
  })
})
