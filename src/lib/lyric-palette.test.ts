import { describe, expect, it } from 'vitest'
import { lyricPaletteFromCoverPixels, silverBlueLyricPalette } from './lyric-palette'

/** 构造 W×H 纯色 RGBA */
function solid(w: number, h: number, r: number, g: number, b: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = r
    data[i * 4 + 1] = g
    data[i * 4 + 2] = b
    data[i * 4 + 3] = 255
  }
  return data
}

describe('lyricPaletteFromCoverPixels', () => {
  it('近黑封面回退银蓝调色板', () => {
    const pal = lyricPaletteFromCoverPixels(solid(64, 64, 8, 8, 12), 64, 64)
    expect(pal).toEqual(silverBlueLyricPalette())
  })

  it('纯白封面(主导色无分数)回退银蓝', () => {
    const pal = lyricPaletteFromCoverPixels(solid(64, 64, 245, 246, 248), 64, 64)
    expect(pal).toEqual(silverBlueLyricPalette())
  })

  it('近白带轻微色度的封面输出深青文字(浅底深字)', () => {
    const pal = lyricPaletteFromCoverPixels(solid(64, 64, 235, 230, 225), 64, 64)
    expect(pal.primary).toBe('#064b5b')
    expect(pal.shadow).toContain('255,255,255')
  })

  it('鲜艳中等亮度封面生成彩色调色板且五字段齐全', () => {
    const pal = lyricPaletteFromCoverPixels(solid(64, 64, 40, 120, 220), 64, 64)
    expect(pal.primary).toMatch(/^rgb\(/)
    expect(pal.secondary).toMatch(/^rgb\(/)
    expect(pal.highlight).toMatch(/^rgb\(/)
    expect(pal.glow).toMatch(/^rgba\(/)
    expect(pal.shadow.length).toBeGreaterThan(0)
    // 深色文字底(avgL<0.52)→浅色文字:主色亮度应偏高
    const m = pal.primary.match(/rgb\((\d+),(\d+),(\d+)\)/)!
    const lum = (Number(m[1]) * 0.299 + Number(m[2]) * 0.587 + Number(m[3]) * 0.114) / 255
    expect(lum).toBeGreaterThan(0.5)
  })

  it('空像素输入回退银蓝', () => {
    expect(lyricPaletteFromCoverPixels(new Uint8ClampedArray(0), 0, 0)).toEqual(silverBlueLyricPalette())
  })
})
