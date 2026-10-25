/**
 * 主题亮暗与主题色的纯计算：背景亮度统计 → 自适应遮罩；主题色 → 按主题调亮/调暗并选对比文字色。
 * 亮度一律用 gamma 空间 Rec.709 加权（与 lumaFromPixels 一致）：CSS 的 opacity 叠加也在 gamma 空间线性混合，
 * 所以「背景亮度 × (1-a) + 底色亮度 × a」就是叠完遮罩后的真实观感亮度。
 */

export interface LumaStats {
  /** 平均亮度 0-1。 */
  mean: number
  /** 偏亮一端（90 分位），避免大片暗图里的亮斑压不住。 */
  high: number
  /** 偏暗一端（10 分位）。 */
  low: number
}

/** RGBA 像素 → 亮度统计；空数据按纯黑处理。 */
export function lumaStatsFromPixels(data: Uint8ClampedArray | number[]): LumaStats {
  const values: number[] = []
  for (let i = 0; i + 3 < data.length; i += 4) {
    values.push((0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255)
  }
  if (values.length === 0) return { mean: 0, high: 0, low: 0 }
  const sorted = [...values].sort((a, b) => a - b)
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]
  return { mean: values.reduce((sum, v) => sum + v, 0) / values.length, high: at(0.9), low: at(0.1) }
}

/** 主题底色亮度（tokens.css 的 --sm-bg-base：深 #0c0c0c / 浅 #f0f0f0）。 */
const BASE_LUMA = { dark: 12 / 255, light: 240 / 255 }
/** 文字可读的背景亮度上/下限：深色主题背景不高于它，浅色主题背景不低于它；玻璃面板还会再垫一层底，不必压到极限。 */
const READABLE_LUMA = { dark: 0.35, light: 0.62 }
/** 自动遮罩上限：再极端的图也留出画面，否则自定义背景等于没设。 */
const AUTO_SCRIM_MAX = 0.75

/**
 * 遮罩（主题底色）不透明度：先自动补到可读亮度，再在剩余空间里叠加用户的额外强度。
 * 亮图配深色、暗图配浅色时自动加重；本就合适的背景只吃用户设置的那一点。
 */
export function scrimOpacity(stats: LumaStats, light: boolean, extra: number, target = light ? READABLE_LUMA.light : READABLE_LUMA.dark): number {
  const base = light ? BASE_LUMA.light : BASE_LUMA.dark
  // 均值为主、极值为辅：只看均值会放过大块亮斑，极值权重过高又会把整张图压死。
  const luma = light ? stats.mean * 0.75 + stats.low * 0.25 : stats.mean * 0.75 + stats.high * 0.25
  const off = light ? target - luma : luma - target
  const auto = off > 0 ? Math.min(AUTO_SCRIM_MAX, off / Math.abs(luma - base)) : 0
  const user = Math.min(1, Math.max(0, extra))
  return Math.min(1, auto + (1 - auto) * user)
}

/** 浅色主题 gamma 指数下限：越小暗部抬得越多，再低画面会发平发雾。 */
const GAMMA_MIN = 0.72
/** 浅色主题图片/视频的目标亮度：比纯色底宽松，文字主要落在玻璃面板上，优先保住原图的明暗与色彩。 */
const LIGHT_MEDIA_TARGET = 0.5

export interface MediaTone {
  /** 主题底色遮罩不透明度。 */
  scrim: number
  /** 作用在图片/视频上的 gamma 指数（out = in^gamma），1 为不调整。 */
  gamma: number
  /** 配合提亮的饱和度补偿，1 为不调整。 */
  saturate: number
}

/**
 * 图片/视频背景的明暗处理。深色主题直接叠黑色遮罩（观感就是调暗）；
 * 浅色主题先用 gamma 曲线抬暗部与中间调、高光几乎不动，够不到可读亮度时才补一点白色遮罩——
 * 整片白遮罩会把色彩和对比一起冲淡（发灰发雾），线性 brightness 又会让高光大片溢白。
 */
export function mediaTone(stats: LumaStats, light: boolean, extra: number): MediaTone {
  if (!light) return { scrim: scrimOpacity(stats, false, extra), gamma: 1, saturate: 1 }
  const luma = stats.mean * 0.75 + stats.low * 0.25
  const gamma = luma > 0.01 && luma < LIGHT_MEDIA_TARGET
    ? Math.max(GAMMA_MIN, Math.log(LIGHT_MEDIA_TARGET) / Math.log(luma)) : 1
  const lift = (v: number) => (v > 0 ? v ** gamma : 0)
  const lifted = { mean: lift(stats.mean), high: lift(stats.high), low: lift(stats.low) }
  return { scrim: scrimOpacity(lifted, true, extra, LIGHT_MEDIA_TARGET), gamma, saturate: 1 + (1 - gamma) * 0.6 }
}

const HEX = /^#[0-9a-f]{6}$/i

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX.test(value)
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map(v => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`
}

/** 解析 #rrggbb 或 rgb(r,g,b)；无法识别返回 null。 */
export function parseColor(value: string): [number, number, number] | null {
  if (HEX.test(value)) return hexToRgb(value)
  const match = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(value.trim())
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}

/** WCAG 相对亮度（线性化），只用于对比度判断。 */
function relativeLuminance([r, g, b]: [number, number, number]): number {
  const lin = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

function mix(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

export interface AccentTokens {
  /** 适配当前主题后的强调色，可作文字色与按钮底色。 */
  accent: string
  /** 强调色底上的文字色（黑或白，取对比更高者）。 */
  onAccent: string
}

/** 强调色作文字时与主题底色至少 4.5:1；不够就往白（深色主题）或黑（浅色主题）方向逐步混。 */
export function accentTokensFor(color: string, light: boolean): AccentTokens | null {
  const rgb = parseColor(color)
  if (!rgb) return null
  const base = hexToRgb(light ? '#f0f0f0' : '#0c0c0c')
  const toward: [number, number, number] = light ? [0, 0, 0] : [255, 255, 255]
  let accent = rgb
  for (let t = 0.1; contrast(accent, base) < 4.5 && t <= 1; t += 0.1) accent = mix(rgb, toward, t)
  const onAccent = contrast(accent, [255, 255, 255]) >= contrast(accent, [0, 0, 0]) ? '#ffffff' : '#0c0c0c'
  return { accent: rgbToHex(accent), onAccent }
}

/** 主题色预设；mono 为原有黑白单色，cover 跟随封面主色，custom 用用户取色。 */
export const ACCENT_PRESETS = [
  { id: 'rose', label: '玫红', color: '#f43f5e' },
  { id: 'amber', label: '琥珀', color: '#f59e0b' },
  { id: 'lime', label: '青柠', color: '#65a30d' },
  { id: 'mint', label: '薄荷', color: '#10b981' },
  { id: 'sky', label: '天青', color: '#0ea5e9' },
  { id: 'indigo', label: '靛蓝', color: '#6366f1' },
  { id: 'violet', label: '紫罗兰', color: '#a855f7' },
] as const

export type AccentPresetId = (typeof ACCENT_PRESETS)[number]['id']
export type AccentMode = 'mono' | 'cover' | 'custom' | AccentPresetId

export const ACCENT_MODES: AccentMode[] = ['mono', 'cover', 'custom', ...ACCENT_PRESETS.map(item => item.id)]
