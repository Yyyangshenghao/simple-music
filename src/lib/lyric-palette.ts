/**
 * 3D 舞台歌词的文字调色板推导(移植自 Mineradio-MacOS 的
 * updateLyricPaletteFromCover / lyricTextPaletteFromHsl)。
 * 从封面像素挑一个"高饱和且亮度居中"的主导色,结合整图平均亮度,
 * 生成 主色/副色/高亮色/阴影/辉光 五件套;暗淡或低饱和封面回退银蓝色。
 */

export interface LyricPalette {
  primary: string
  secondary: string
  highlight: string
  shadow: string
  glow: string
  /** 辉光层颜色,缺省用 secondary */
  glowColor?: string
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

/** RGB(0-255) → HSL,h/s/l 均为 0-1。 */
function rgbToHsl01(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) h = ((b - r) / d + 2) / 6
  else h = ((r - g) / d + 4) / 6
  return { h, s, l }
}

/** HSL(0-1) → rgb() CSS 字符串。 */
function hslCss(h: number, s: number, l: number): string {
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p + (q - p) * 6 * t
  }
  let r: number, g: number, b: number
  if (s === 0) {
    r = g = b = l
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s
    const p = 2 * l - q
    r = hue2rgb(p, q, h + 1 / 3)
    g = hue2rgb(p, q, h)
    b = hue2rgb(p, q, h - 1 / 3)
  }
  return `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`
}

/** 暗淡/低饱和封面的银蓝回退调色板。 */
export function silverBlueLyricPalette(): LyricPalette {
  return {
    primary: '#d8f1ff',
    secondary: '#9db8cf',
    highlight: '#eef7ff',
    shadow: 'rgba(0,7,12,0.48)',
    glow: 'rgba(138,190,255,0.26)'
  }
}

function paletteFromHsl(hsl: { h: number; s: number; l: number }, avgL: number, chroma: number): LyricPalette {
  if (avgL < 0.16 || chroma < 0.08) return silverBlueLyricPalette()
  // 暗封面且主导色落在红紫区(易显脏)时也回退银蓝
  const hue = hsl.h
  if (avgL < 0.3 && (hue < 0.06 || hue > 0.75)) return silverBlueLyricPalette()
  // 亮而低饱和(近白封面):用深青色文字保证对比
  if (avgL > 0.82 && chroma < 0.12) {
    return {
      primary: '#064b5b',
      secondary: '#168c88',
      highlight: '#315f68',
      shadow: 'rgba(255,255,255,0.48)',
      glow: 'rgba(143,233,255,0.14)'
    }
  }
  const lightText = avgL < 0.52
  const s = clamp(hsl.s + 0.16, 0.42, 0.78)
  const primary = hslCss(hsl.h, s, lightText ? 0.74 : 0.34)
  return {
    primary,
    secondary: hslCss((hsl.h + 0.08) % 1, Math.max(0.36, s - 0.1), lightText ? 0.62 : 0.46),
    highlight: hslCss((hsl.h + 0.03) % 1, Math.max(0.28, s - 0.18), lightText ? 0.86 : 0.58),
    shadow: lightText ? 'rgba(0,6,10,0.44)' : 'rgba(248,253,255,0.40)',
    glow: primary.replace('rgb(', 'rgba(').replace(')', `,${lightText ? 0.24 : 0.14})`)
  }
}

/**
 * 从封面 RGBA 像素推导歌词调色板:每 8px 采样,
 * 按「色度×1.6 + 亮度居中程度×0.45」评分挑主导色。
 */
export function lyricPaletteFromCoverPixels(data: Uint8ClampedArray, w: number, h: number): LyricPalette {
  let sumR = 0
  let sumG = 0
  let sumB = 0
  let count = 0
  const best = { score: -1, r: 143, g: 233, b: 255 }
  for (let y = 0; y < h; y += 8) {
    for (let x = 0; x < w; x += 8) {
      const di = (y * w + x) * 4
      const r = data[di]
      const g = data[di + 1]
      const b = data[di + 2]
      if (data[di + 3] / 255 < 0.5) continue
      const lum = (r * 0.299 + g * 0.587 + b * 0.114) / 255
      const chroma = (Math.max(r, g, b) - Math.min(r, g, b)) / 255
      const score = chroma * 1.6 + (0.5 - Math.abs(lum - 0.5)) * 0.45
      sumR += r
      sumG += g
      sumB += b
      count++
      if (lum > 0.08 && lum < 0.92 && score > best.score) {
        best.score = score
        best.r = r
        best.g = g
        best.b = b
      }
    }
  }
  if (!count) return silverBlueLyricPalette()
  const avgL = ((sumR / count) * 0.299 + (sumG / count) * 0.587 + (sumB / count) * 0.114) / 255
  return paletteFromHsl(rgbToHsl01(best.r, best.g, best.b), avgL, Math.max(0, best.score))
}
