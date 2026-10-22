/** Canvas 样式用的颜色小工具：把浏览器解析后的颜色（rgb() 或 color(srgb …)）转成数值，便于混色与比较亮度。 */

export type Rgb = [number, number, number]

export function parseCssColor(value: string, fallback: Rgb = [255, 255, 255]): Rgb {
  const text = value.trim()
  const srgb = /^color\(srgb\s+([\d.e+-]+)\s+([\d.e+-]+)\s+([\d.e+-]+)/i.exec(text)
  if (srgb) return [Number(srgb[1]) * 255, Number(srgb[2]) * 255, Number(srgb[3]) * 255].map(v => Math.round(Math.min(255, Math.max(0, v)))) as Rgb
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(text)
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])].map(v => Math.round(Math.min(255, Math.max(0, v)))) as Rgb
  const hex = /^#([\da-f]{6})$/i.exec(text)
  if (hex) return [0, 2, 4].map(i => parseInt(hex[1].slice(i, i + 2), 16)) as Rgb
  return fallback
}

/** a 占 weight，b 占 1-weight。 */
export function mixRgb(a: Rgb, b: Rgb, weight: number): Rgb {
  const w = Math.min(1, Math.max(0, weight))
  return [0, 1, 2].map(i => Math.round(a[i] * w + b[i] * (1 - w))) as Rgb
}

/** 相对亮度 0..1（sRGB 线性化）。 */
export function luminance([r, g, b]: Rgb): number {
  const lin = (v: number) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/** 在两种候选文字色里挑与底色对比更强的一种。 */
export function contrastOn(background: Rgb, a: Rgb, b: Rgb): Rgb {
  const bg = luminance(background)
  const ratio = (c: Rgb) => {
    const l = luminance(c)
    return (Math.max(l, bg) + 0.05) / (Math.min(l, bg) + 0.05)
  }
  return ratio(a) >= ratio(b) ? a : b
}

export const rgbCss = ([r, g, b]: Rgb, alpha = 1) => alpha >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${alpha})`
