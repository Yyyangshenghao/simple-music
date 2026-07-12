import { describe, it, expect } from 'vitest'
import { bassEnergyFrom, smoothEnergy, bandEnergiesFrom } from './audio-energy'

describe('bassEnergyFrom', () => {
  it('空数据返回 0', () => {
    expect(bassEnergyFrom([])).toBe(0)
    expect(bassEnergyFrom(new Uint8Array(0))).toBe(0)
  })

  it('前 16 bin 全 255 返回 1（后续 bin 不参与）', () => {
    const data = new Uint8Array(32)
    data.fill(255, 0, 16)
    // 17 之后是 0，但不在取样范围内
    expect(bassEnergyFrom(data)).toBe(1)
  })

  it('部分能量按前 16 bin 平均', () => {
    // 前 16 bin 全 51 → 51/255 = 0.2
    const data = new Array(16).fill(51)
    expect(bassEnergyFrom(data)).toBeCloseTo(0.2, 5)
  })

  it('bin 数不足 16 时按实际长度平均', () => {
    expect(bassEnergyFrom([255, 255, 255, 255])).toBe(1)
  })
})

describe('smoothEnergy', () => {
  it('上升比下降快（attack 快 release 慢）', () => {
    const up = smoothEnergy(0, 1) // 上升一步
    const down = 1 - smoothEnergy(1, 0) // 下降一步的降幅
    expect(up).toBeGreaterThan(down)
  })

  it('相等时不变', () => {
    expect(smoothEnergy(0.5, 0.5)).toBe(0.5)
  })

  it('多步后向目标收敛', () => {
    let v = 0
    for (let i = 0; i < 60; i++) v = smoothEnergy(v, 1)
    expect(v).toBeGreaterThan(0.95)
  })
})

describe('bandEnergiesFrom', () => {
  it('空数据全部返回 0', () => {
    expect(bandEnergiesFrom([])).toEqual({
      subBass: 0,
      bass: 0,
      lowMid: 0,
      mid: 0,
      highMid: 0,
      presence: 0,
      air: 0,
      energy: 0
    })
  })

  it('单一频段拉满时只有该频段与 energy 受影响', () => {
    const data = new Uint8Array(1024)
    data.fill(255, 23, 93) // mid 频段范围 [23,93)
    const bands = bandEnergiesFrom(data)
    expect(bands.mid).toBe(1)
    expect(bands.subBass).toBe(0)
    expect(bands.bass).toBe(0)
    expect(bands.lowMid).toBe(0)
    expect(bands.highMid).toBe(0)
    expect(bands.presence).toBe(0)
    expect(bands.air).toBe(0)
    expect(bands.energy).toBeCloseTo((93 - 23) / 1024, 5)
  })

  it('全频谱拉满时七段与 energy 均为 1', () => {
    const data = new Uint8Array(1024).fill(255)
    const bands = bandEnergiesFrom(data)
    expect(bands.subBass).toBe(1)
    expect(bands.bass).toBe(1)
    expect(bands.lowMid).toBe(1)
    expect(bands.mid).toBe(1)
    expect(bands.highMid).toBe(1)
    expect(bands.presence).toBe(1)
    expect(bands.air).toBe(1)
    expect(bands.energy).toBe(1)
  })

  it('数据长度不足某频段范围时该频段返回 0', () => {
    const data = [200, 200]
    const bands = bandEnergiesFrom(data)
    expect(bands.mid).toBe(0)
    expect(bands.air).toBe(0)
  })
})
