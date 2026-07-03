export function extractColor(img: HTMLImageElement): string {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 8
    canvas.height = 8
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(img, 0, 0, 8, 8)
    const d = ctx.getImageData(0, 0, 8, 8).data
    let r = 0, g = 0, b = 0
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i+1]; b += d[i+2] }
    const px = d.length / 4
    return `rgb(${Math.round(r/px)},${Math.round(g/px)},${Math.round(b/px)})`
  } catch {
    return 'rgb(20,30,55)'
  }
}

/** 默认霞光调色板（无封面/提取失败时使用），与 LiquidEther 初始色一致。 */
export const DEFAULT_PALETTE: [string, string, string] = ['#5227ff', '#ff9ffc', '#b497cf']

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

/** RGB(0-255) → HSL（h: 0-360, s/l: 0-1）。 */
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255
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

/** HSL → hex 字符串（#rrggbb 小写）。 */
function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let r = 0, g = 0, b = 0
  if (h < 60) { r = c; g = x }
  else if (h < 120) { r = x; g = c }
  else if (h < 180) { g = c; b = x }
  else if (h < 240) { g = x; b = c }
  else if (h < 300) { r = x; b = c }
  else { r = c; b = x }
  const to2 = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0')
  return `#${to2(r)}${to2(g)}${to2(b)}`
}

/**
 * 从 RGBA 像素数组提取三个主导色（用于霞光氛围）。
 * 按 30° 色相桶聚类，过滤近黑/近白/低饱和像素，按「饱和度 × 中间亮度」加权；
 * 输出做饱和度/亮度钳制，保证深色底上不脏不刺眼；不足三色用默认色补齐。
 */
export function paletteFromPixels(data: Uint8ClampedArray | number[]): [string, string, string] {
  const buckets = new Map<number, { w: number; r: number; g: number; b: number }>()
  for (let i = 0; i + 3 < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2]
    const [h, s, l] = rgbToHsl(r, g, b)
    if (l < 0.08 || l > 0.95 || s < 0.12) continue
    const key = Math.floor(h / 30) % 12
    const w = s * (1 - Math.abs(l - 0.5))
    const cur = buckets.get(key) ?? { w: 0, r: 0, g: 0, b: 0 }
    cur.w += w; cur.r += r * w; cur.g += g * w; cur.b += b * w
    buckets.set(key, cur)
  }
  const top = [...buckets.values()].sort((a, b) => b.w - a.w).slice(0, 3)
  const out = top.map((bk) => {
    const [h, s, l] = rgbToHsl(bk.r / bk.w, bk.g / bk.w, bk.b / bk.w)
    return hslToHex(h, clamp(s, 0.55, 0.9), clamp(l, 0.55, 0.72))
  })
  while (out.length < 3) out.push(DEFAULT_PALETTE[out.length])
  return [out[0], out[1], out[2]]
}

/** 从已加载的图片提取霞光调色板（24×24 canvas 采样），异常回退默认色。 */
export function extractPalette(img: HTMLImageElement): [string, string, string] {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 24
    canvas.height = 24
    const ctx = canvas.getContext('2d')
    if (!ctx) return [...DEFAULT_PALETTE]
    ctx.drawImage(img, 0, 0, 24, 24)
    return paletteFromPixels(ctx.getImageData(0, 0, 24, 24).data)
  } catch {
    return [...DEFAULT_PALETTE]
  }
}
