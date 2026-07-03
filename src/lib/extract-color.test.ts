import { describe, it, expect } from 'vitest'
import { paletteFromPixels, DEFAULT_PALETTE } from './extract-color'

/** 构造 n 个相同 RGBA 像素的数组。 */
function pixels(r: number, g: number, b: number, n: number): number[] {
  const out: number[] = []
  for (let i = 0; i < n; i++) out.push(r, g, b, 255)
  return out
}

function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60
  else if (max === g) h = ((b - r) / d + 2) * 60
  else h = ((r - g) / d + 4) * 60
  return [h, s, l]
}

describe('paletteFromPixels', () => {
  it('纯红图像：主色落在红色系且亮度被钳制到可读区间', () => {
    const [c1] = paletteFromPixels(pixels(255, 0, 0, 64))
    const [h, s, l] = hexToHsl(c1)
    expect(h < 30 || h > 330).toBe(true)
    expect(s).toBeGreaterThanOrEqual(0.5)
    expect(s).toBeLessThanOrEqual(0.95)
    expect(l).toBeGreaterThanOrEqual(0.5)
    expect(l).toBeLessThanOrEqual(0.75)
  })

  it('蓝黄双色图像：前两个主导色 hue 明显不同', () => {
    const data = [...pixels(30, 60, 230, 40), ...pixels(240, 200, 40, 24)]
    const [c1, c2] = paletteFromPixels(data)
    const [h1] = hexToHsl(c1)
    const [h2] = hexToHsl(c2)
    // 蓝像素更多 → 主色是蓝
    expect(h1).toBeGreaterThan(180)
    expect(h1).toBeLessThan(280)
    expect(Math.abs(h1 - h2)).toBeGreaterThan(60)
  })

  it('全黑图像：回退默认霞光调色板', () => {
    expect(paletteFromPixels(pixels(0, 0, 0, 64))).toEqual(DEFAULT_PALETTE)
  })

  it('灰色图像（低饱和）：回退默认霞光调色板', () => {
    expect(paletteFromPixels(pixels(128, 128, 128, 64))).toEqual(DEFAULT_PALETTE)
  })

  it('单色图像不足三色时用默认色补齐', () => {
    const result = paletteFromPixels(pixels(255, 0, 0, 64))
    expect(result).toHaveLength(3)
    expect(result[1]).toBe(DEFAULT_PALETTE[1])
    expect(result[2]).toBe(DEFAULT_PALETTE[2])
  })
})
