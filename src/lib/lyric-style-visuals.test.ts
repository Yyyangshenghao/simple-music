import { describe, it, expect } from 'vitest'
import { wordState } from './lyric-style-layouts'
import { partitaVisual } from './lyric-style-visuals'

const word = { text: '光', startMs: 1000, endMs: 1600 }
const at = (ms: number) => wordState(word, ms)
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
