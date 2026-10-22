import { describe, it, expect } from 'vitest'
import { wordState } from './lyric-style-layouts'
import { luminousVisual, partitaVisual, tiltVisual } from './lyric-style-visuals'

const word = { text: '光', startMs: 1000, endMs: 1600 }
const at = (ms: number) => wordState(word, ms)
const lum = (ms: number, extra: Partial<{ animated: boolean; glow: number; ripple: boolean; beat: number }> = {}) =>
  luminousVisual(at(ms), { animated: true, glow: 1, ripple: true, beat: 0, ...extra })

describe('流光逐帧视觉', () => {
  it('远离开唱时浅淡下沉，临近开唱逐渐浮起清晰', () => {
    const far = lum(0)
    const near = lum(900)
    expect(far.opacity).toBeCloseTo(0.16)
    expect(far.lift).toBeGreaterThan(near.lift)
    expect(far.blur).toBeGreaterThan(near.blur)
    expect(near.opacity).toBeGreaterThan(far.opacity)
  })

  it('演唱中全亮、强调色、发光并荡开涟漪；随拍让辉光更强', () => {
    const active = lum(1300)
    expect(active).toMatchObject({ opacity: 1, heat: 1, blur: 0 })
    expect(active.glow).toBeGreaterThan(0.6)
    expect(active.ripple).toBeGreaterThan(0)
    expect(active.ripple).toBeLessThan(1)
    expect(lum(1300, { beat: 1 }).glow).toBeGreaterThan(active.glow)
    expect(lum(1300, { glow: 0 }).glow).toBe(0)
    expect(lum(1300, { ripple: false }).ripple).toBe(1)
  })

  it('唱后余晖随时间衰减，透明度有下限，上漂有上限', () => {
    const soon = lum(1700)
    const later = lum(4000)
    expect(soon.heat).toBeGreaterThan(later.heat)
    expect(soon.glow).toBeGreaterThan(later.glow)
    expect(lum(60_000).opacity).toBeCloseTo(0.62)
    expect(lum(60_000).lift).toBeCloseTo(-0.22)
  })

  it('静态模式全文可读，不位移、不模糊，只标出正在唱的词', () => {
    for (const ms of [0, 1300, 5000]) {
      const v = lum(ms, { animated: false })
      expect(v).toMatchObject({ lift: 0, scale: 1, blur: 0, glow: 0, ripple: 1 })
      expect(v.opacity).toBeGreaterThanOrEqual(0.55)
    }
    expect(lum(1300, { animated: false }).heat).toBe(1)
    expect(lum(5000, { animated: false }).heat).toBe(0)
  })
})

describe('倾诉逐帧视觉', () => {
  it('提前少许开始浮现，落定后完全不透明；唱后强调色退去', () => {
    expect(tiltVisual(at(0), true).opacity).toBe(0)
    expect(tiltVisual(at(900), true).opacity).toBeGreaterThan(0)
    expect(tiltVisual(at(1200), true)).toMatchObject({ opacity: 1, rise: 0, blur: 0, heat: 1 })
    expect(tiltVisual(at(1700), true).heat).toBeGreaterThan(tiltVisual(at(3000), true).heat)
  })

  it('静态模式所有词都可见', () => {
    expect(tiltVisual(at(0), false).opacity).toBe(0.5)
    expect(tiltVisual(at(5000), false)).toMatchObject({ opacity: 1, rise: 0, heat: 0 })
  })
})

describe('云阶逐帧视觉', () => {
  it('等待浅色，演唱时放大并带强调色，唱后 0.35s 回落到原字号', () => {
    expect(partitaVisual(at(0), { animated: true, emphasis: 1 })).toEqual({ opacity: 0.22, scale: 1, heat: 0 })
    const peak = partitaVisual(at(1260), { animated: true, emphasis: 1 })
    expect(peak.heat).toBe(1)
    expect(peak.scale).toBeGreaterThan(1.25)
    expect(partitaVisual(at(1700), { animated: true, emphasis: 1 }).scale).toBeGreaterThan(1)
    expect(partitaVisual(at(2000), { animated: true, emphasis: 1 })).toEqual({ opacity: 0.92, scale: 1, heat: 0 })
  })

  it('强调放大为 0 时不放大；静态模式不缩放但仍标色', () => {
    expect(partitaVisual(at(1300), { animated: true, emphasis: 0 }).scale).toBe(1)
    expect(partitaVisual(at(1300), { animated: false, emphasis: 1 })).toEqual({ opacity: 1, scale: 1, heat: 1 })
  })
})
