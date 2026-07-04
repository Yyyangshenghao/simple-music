import { describe, it, expect } from 'vitest'
import { bassEnergyFrom, smoothEnergy } from './audio-energy'

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
