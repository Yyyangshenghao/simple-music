import { describe, expect, it } from 'vitest'
import { PlaybackLyricClock } from './playback-lyric-clock'

describe('普通音频歌词连续时钟', () => {
  it('吸收迟到采样，重复快照不续期，最多推算半秒', () => {
    const clock = new PlaybackLyricClock()
    clock.reset(10, true, 180, 1, 0)
    clock.update(10.18, true, 180, 1, 240)
    expect(clock.read(240)).toBeCloseTo(10.24)
    expect(clock.read(300)).toBeCloseTo(10.3)
    clock.update(10.18, true, 180, 1, 600)
    expect(clock.read(10000)).toBeCloseTo(10.68)
  })

  it('暂停冻结，忽略淡出采样，恢复播放从定格位置继续', () => {
    const clock = new PlaybackLyricClock()
    clock.reset(10, true, 180, 1, 0)
    clock.update(10, false, 180, 1, 240)
    clock.update(10.29, false, 180, 1, 400)
    expect(clock.read(1200)).toBeCloseTo(10.24)
    clock.update(10.29, true, 180, 1, 2000)
    expect(clock.read(2100)).toBeCloseTo(10.39)
  })

  it('按播放速度推进，减速时不能倒退', () => {
    const clock = new PlaybackLyricClock()
    clock.reset(10, true, 180, 2, 0)
    expect(clock.read(400)).toBeCloseTo(10.8)
    clock.update(10.6, true, 180, 0.5, 450)
    expect(clock.read(450)).toBeCloseTo(10.9)
    clock.update(10.9, true, 180, 0.5, 600)
    expect(clock.read(800)).toBeCloseTo(11)
  })

  it('显式定位允许小幅后退，大幅校时和歌曲结束保持准确', () => {
    const clock = new PlaybackLyricClock()
    clock.reset(10, true, 180, 1, 0)
    clock.reset(10, false, 180, 1, 400)
    expect(clock.read(1200)).toBe(10)
    clock.update(80, true, 180, 1, 1500)
    expect(clock.read(1500)).toBe(80)
    clock.reset(179.9, true, 180, 2, 2000)
    expect(clock.read(2400)).toBe(180)
  })
})
