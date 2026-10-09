import { describe, expect, it } from 'vitest'
import { lightLyricPalette, lyricPaletteFromCoverPixels, silverBlueLyricPalette } from './lyric-palette'

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
    expect(Number(m[3])).toBeGreaterThan(Number(m[1]))
    for (const value of m.slice(1)) expect(Number(value)).toBeLessThanOrEqual(255)
    const lum = (Number(m[1]) * 0.299 + Number(m[2]) * 0.587 + Number(m[3]) * 0.114) / 255
    expect(lum).toBeGreaterThan(0.5)
  })

  it('空像素输入回退银蓝', () => {
    expect(lyricPaletteFromCoverPixels(new Uint8ClampedArray(0), 0, 0)).toEqual(silverBlueLyricPalette())
  })
})

describe('浅色舞台歌词配色', () => {
  const channels = (css: string) => css.match(/\d+/g)!.map(Number)

  it('蓝色与橙色封面保持各自色相，不会都压成近黑色', () => {
    const blue = lightLyricPalette(lyricPaletteFromCoverPixels(solid(64, 64, 40, 120, 220), 64, 64))
    const orange = lightLyricPalette(lyricPaletteFromCoverPixels(solid(64, 64, 220, 130, 40), 64, 64))
    for (const key of ['primary', 'highlight'] as const) {
      const [r, , b] = channels(blue[key])
      expect(b).toBeGreaterThan(r * 2)
      expect(b).toBeGreaterThan(90)
      const [or, , ob] = channels(orange[key])
      expect(or).toBeGreaterThan(ob * 2)
      expect(or).toBeGreaterThan(90)
    }
  })

  it('已唱与未唱颜色有区分，亮度仍适合浅底，原深色调色板不被修改', () => {
    const original = silverBlueLyricPalette()
    const before = { ...original }
    const adapted = lightLyricPalette(original)
    expect(adapted.primary).not.toBe(adapted.highlight)
    for (const key of ['primary', 'highlight'] as const) {
      const rgb = channels(adapted[key])
      const linear = rgb.map(value => {
        const s = value / 255
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
      })
      const luminance = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722
      expect((1.05) / (luminance + 0.05)).toBeGreaterThan(4.5)
    }
    expect(original).toEqual(before)
  })

  it('黄色封面仍保留黄色，同时让较小译文有足够对比', () => {
    const palette = lightLyricPalette(lyricPaletteFromCoverPixels(solid(64, 64, 220, 220, 40), 64, 64))
    const [r, g, b] = channels(palette.primary)
    expect(r).toBeGreaterThan(b * 3)
    expect(g).toBeGreaterThan(b * 3)
    const linear = [r, g, b].map(value => ((value / 255 + 0.055) / 1.055) ** 2.4)
    expect(1.05 / (linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722 + 0.05)).toBeGreaterThan(6)
  })
})
