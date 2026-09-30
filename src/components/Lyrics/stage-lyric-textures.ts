import * as THREE from 'three'
import type { WordToken } from '../../types/domain'
import { measureWordBoundaries, normalizeStageLyricText } from './stage-lyric-progress'
import { planStageLyricRows } from './stage-lyric-wrap'

/**
 * 3D 舞台歌词的 canvas 纹理生成(移植自 Mineradio-MacOS 的
 * makeLyricMask / makeLyricReadabilityTexture / makeLyricGlowTexture / getLyricSunBloomTexture)。
 * 字体优先使用独立的 3D 歌词设置，留空时跟随应用正文字体。
 */

export interface LyricMask {
  texture: THREE.CanvasTexture
  width: number
  height: number
  textWidth: number
  textHeight: number
  fontSize: number
  lineHeight: number
  lines: string[]
  fitScaleX: number
  /** 文字区在 U 方向的起止(0-1),供进度 shader 把 uProgress 映射到字面 */
  textMin: number
  textMax: number
  wordBoundaries: number[]
  rowRanges: Array<[number, number]>
}

let cachedFontStack: string | null = null
function fontStack(): string {
  if (!cachedFontStack) {
    const custom = typeof document !== 'undefined'
      ? document.documentElement.style.getPropertyValue('--sm-lyrics-3d-font-sans').trim()
      : ''
    cachedFontStack = custom || (typeof document !== 'undefined' && document.body
      ? getComputedStyle(document.body).fontFamily
      : '') || 'Inter,"Noto Sans SC","PingFang SC","Microsoft YaHei",Arial,sans-serif'
  }
  return cachedFontStack
}

function fontCss(fontSize: number): string {
  return `800 ${fontSize}px ${fontStack()}`
}

function makeCanvasTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas)
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.generateMipmaps = false
  return tex
}

/** 将超长句排成两行，优先保持可读字号；画布和世界平面尺寸不变。 */
export function makeLyricMask(text: string, opts?: { maxFont?: number; minFont?: number; textureScale?: number; words?: WordToken[] }): LyricMask {
  const textureScale = Math.max(0.25, Math.min(1, opts?.textureScale ?? 1))
  const W = Math.round(2048 * textureScale)
  const H = Math.round(384 * textureScale)
  const maxFont = (opts?.maxFont ?? 128) * textureScale
  const minFont = (opts?.minFont ?? 42) * textureScale
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  const maxWidth = W - 190 * textureScale
  text = normalizeStageLyricText(String(text || ''))
  ctx.font = fontCss(maxFont)
  const rows = planStageLyricRows(text, maxWidth, (value) => ctx.measureText(value).width, opts?.words)
  let fontSize = maxFont
  let widest = 1
  const readableMin = rows.lines.length === 2 ? Math.max(minFont, maxFont * 0.7) : minFont
  for (; fontSize >= readableMin; fontSize -= 4 * textureScale) {
    ctx.font = fontCss(fontSize)
    widest = Math.max(1, ...rows.lines.map((line) => ctx.measureText(line).width))
    if (widest <= maxWidth) break
  }
  fontSize = Math.max(readableMin, fontSize)
  ctx.font = fontCss(fontSize)
  // 边界必须用最终字号测量，避免字距/字体 hinting 使逐字高亮错位。
  const wordBoundaries = opts?.words
    ? rows.lines.length === 2
      ? [
          ...measureWordBoundaries(opts.words.slice(0, rows.splitWordIndex), (value) => ctx.measureText(value).width).map((v) => v * 0.5),
          ...measureWordBoundaries(opts.words.slice(rows.splitWordIndex), (value) => ctx.measureText(value).width).slice(1).map((v) => 0.5 + v * 0.5)
        ]
      : measureWordBoundaries(opts.words, (value) => ctx.measureText(value).width)
    : []
  const widths = rows.lines.map((line) => Math.max(1, ctx.measureText(line).width))
  widest = Math.max(...widths)
  const fitScaleX = widest > maxWidth ? maxWidth / widest : 1
  const width = Math.min(maxWidth, widest * fitScaleX)
  const yPositions = rows.lines.length === 2
    ? [H / 2 - fontSize * 0.60, H / 2 + fontSize * 0.90]
    : [H / 2 - fontSize / 2 + fontSize * 0.82]
  ctx.clearRect(0, 0, W, H)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = '#fff'
  rows.lines.forEach((line, index) => {
    if (fitScaleX < 1) {
      ctx.save()
      ctx.translate(W / 2, 0)
      ctx.scale(fitScaleX, 1)
      ctx.fillText(line, 0, yPositions[index])
      ctx.restore()
    } else {
      ctx.fillText(line, W / 2, yPositions[index])
    }
  })

  return {
    texture: makeCanvasTexture(canvas),
    width: W,
    height: H,
    textWidth: width,
    textHeight: fontSize * rows.lines.length,
    fontSize,
    lineHeight: fontSize,
    lines: rows.lines,
    fitScaleX,
    textMin: (W / 2 - width / 2) / W,
    textMax: (W / 2 + width / 2) / W,
    wordBoundaries,
    rowRanges: widths.map((rowWidth) => [(W / 2 - rowWidth * fitScaleX / 2) / W, (W / 2 + rowWidth * fitScaleX / 2) / W])
  }
}

/** 中性字形暗影：柔化背景细节、分离文字轮廓，不绘制硬描边或矩形底板。 */
export function makeReadabilityTexture(mask: LyricMask): THREE.CanvasTexture {
  const { width: W, height: H, fontSize, lines, fitScaleX } = mask
  const canvas = document.createElement('canvas')
  const scale = 0.5
  canvas.width = Math.ceil(W * scale)
  canvas.height = Math.ceil(H * scale)
  const ctx = canvas.getContext('2d')!
  ctx.scale(scale, scale)
  ctx.clearRect(0, 0, W, H)
  ctx.font = fontCss(fontSize)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.miterLimit = 2
  const yPositions = lines.length === 2
    ? [H / 2 - fontSize * 0.60, H / 2 + fontSize * 0.90]
    : [H / 2 - fontSize / 2 + fontSize * 0.82]

  const strokeLines = (dy: number) => {
    lines.forEach((line, index) => {
      const y = yPositions[index] + dy
      if (fitScaleX < 1) {
        ctx.save()
        ctx.translate(W / 2, 0)
        ctx.scale(fitScaleX, 1)
        ctx.strokeText(line, 0, y)
        ctx.restore()
      } else {
        ctx.strokeText(line, W / 2, y)
      }
    })
  }
  const pass = (blur: number, alpha: number, lineWidth: number, color: string, dy = 0) => {
    ctx.save()
    ctx.filter = `blur(${blur * scale}px)`
    ctx.globalAlpha = alpha
    ctx.lineWidth = lineWidth
    ctx.strokeStyle = color
    strokeLines(dy)
    ctx.restore()
  }
  pass(10, 0.24, Math.max(12, fontSize * 0.11), 'rgba(0,0,0,1)')
  pass(3.5, 0.40, Math.max(5, fontSize * 0.045), 'rgba(0,0,0,1)')

  return makeCanvasTexture(canvas)
}

export interface LyricGlowTexture {
  texture: THREE.CanvasTexture
  width: number
  height: number
  textWidth: number
}

/** 多层模糊白字辉光纹理(additive 叠加用),四周渐隐避免硬边。 */
export function makeGlowTexture(mask: LyricMask): LyricGlowTexture {
  const fontSize = mask.fontSize
  const measuredWidth = Math.max(1, mask.textWidth)
  const padX = Math.max(160, fontSize * 1.45)
  const padY = Math.max(86, fontSize * 0.78)
  const W = Math.ceil(measuredWidth + padX * 2)
  const H = Math.ceil(Math.max(mask.height, mask.textHeight + padY * 2))
  const canvas = document.createElement('canvas')
  // 模糊辉光使用四分之一边长；正文 mask 仍保留原始分辨率。
  const scale = 0.25
  canvas.width = Math.ceil(W * scale)
  canvas.height = Math.ceil(H * scale)
  const ctx = canvas.getContext('2d')!
  ctx.scale(scale, scale)
  ctx.clearRect(0, 0, W, H)
  // 复用已经栅格化的清晰字形，避免每一层模糊都重新描边和排版文字。
  const drawGlowText = (dx: number, dy: number) => {
    ctx.drawImage(
      mask.texture.image,
      (mask.width - measuredWidth) / 2, 0, measuredWidth, mask.height,
      padX + dx, (H - mask.height) / 2 + dy, measuredWidth, mask.height
    )
  }
  const pass = (blur: number, alpha: number) => {
    ctx.save()
    ctx.filter = `blur(${blur * scale}px)`
    ctx.globalAlpha = alpha
    drawGlowText(0, 0)
    ctx.restore()
  }
  pass(14, 0.60)
  pass(34, 0.46)
  pass(78, 0.32)
  pass(116, 0.20)
  // 环形位移叠印:轮廓向外糊开一圈
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.filter = `blur(${8 * scale}px)`
  ctx.globalAlpha = 0.26
  ctx.fillStyle = '#fff'
  ctx.lineWidth = 0
  for (let ri = 0; ri < 8; ri++) {
    const ang = (ri / 8) * Math.PI * 2
    drawGlowText(Math.cos(ang) * 7, Math.sin(ang) * 4)
  }
  ctx.restore()
  // 四周渐隐
  ctx.save()
  ctx.globalCompositeOperation = 'destination-in'
  const xMask = ctx.createLinearGradient(0, 0, W, 0)
  xMask.addColorStop(0, 'rgba(255,255,255,0)')
  xMask.addColorStop(0.1, 'rgba(255,255,255,1)')
  xMask.addColorStop(0.9, 'rgba(255,255,255,1)')
  xMask.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = xMask
  ctx.fillRect(0, 0, W, H)
  const yMask = ctx.createLinearGradient(0, 0, 0, H)
  yMask.addColorStop(0, 'rgba(255,255,255,0)')
  yMask.addColorStop(0.16, 'rgba(255,255,255,1)')
  yMask.addColorStop(0.84, 'rgba(255,255,255,1)')
  yMask.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = yMask
  ctx.fillRect(0, 0, W, H)
  ctx.restore()

  return { texture: makeCanvasTexture(canvas), width: W, height: H, textWidth: measuredWidth }
}

let cachedSunTexture: THREE.CanvasTexture | null = null

/** 文字背后的暖色"太阳"辉光横椭圆纹理;模块级缓存,勿 dispose。 */
export function getSunBloomTexture(): THREE.CanvasTexture {
  if (cachedSunTexture) return cachedSunTexture
  const canvas = document.createElement('canvas')
  canvas.width = 1024
  canvas.height = 512
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  const cx = canvas.width * 0.5
  const cy = canvas.height * 0.5
  ctx.save()
  ctx.translate(cx, cy)
  ctx.scale(2.05, 1)
  const radial = ctx.createRadialGradient(0, 0, 0, 0, 0, canvas.height * 0.43)
  radial.addColorStop(0, 'rgba(255,246,186,0.92)')
  radial.addColorStop(0.18, 'rgba(255,219,126,0.44)')
  radial.addColorStop(0.46, 'rgba(255,186,82,0.15)')
  radial.addColorStop(1, 'rgba(255,186,82,0)')
  ctx.fillStyle = radial
  ctx.fillRect(-canvas.width, -canvas.height, canvas.width * 2, canvas.height * 2)
  ctx.restore()
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.filter = 'blur(34px)'
  ctx.fillStyle = 'rgba(255,235,168,0.18)'
  ctx.beginPath()
  ctx.ellipse(cx, cy, canvas.width * 0.33, canvas.height * 0.14, -0.06, 0, Math.PI * 2)
  ctx.fill()
  ctx.filter = 'blur(58px)'
  ctx.fillStyle = 'rgba(255,214,122,0.11)'
  ctx.beginPath()
  ctx.ellipse(cx, cy, canvas.width * 0.45, canvas.height * 0.19, -0.05, 0, Math.PI * 2)
  ctx.fill()
  ctx.filter = 'blur(18px)'
  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, canvas.width * 0.16)
  core.addColorStop(0, 'rgba(255,252,220,0.38)')
  core.addColorStop(0.34, 'rgba(255,230,158,0.20)')
  core.addColorStop(1, 'rgba(255,210,116,0)')
  ctx.fillStyle = core
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.restore()
  ctx.save()
  ctx.globalCompositeOperation = 'destination-in'
  const xMask = ctx.createLinearGradient(0, 0, canvas.width, 0)
  xMask.addColorStop(0, 'rgba(255,255,255,0)')
  xMask.addColorStop(0.11, 'rgba(255,255,255,1)')
  xMask.addColorStop(0.89, 'rgba(255,255,255,1)')
  xMask.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = xMask
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  const yMask = ctx.createLinearGradient(0, 0, 0, canvas.height)
  yMask.addColorStop(0, 'rgba(255,255,255,0)')
  yMask.addColorStop(0.18, 'rgba(255,255,255,1)')
  yMask.addColorStop(0.82, 'rgba(255,255,255,1)')
  yMask.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = yMask
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.restore()
  cachedSunTexture = makeCanvasTexture(canvas)
  return cachedSunTexture
}

/** 应用字体设置变化后清掉字体栈缓存(下一次栅格化重新读取)。 */
export function invalidateLyricFontCache(): void {
  cachedFontStack = null
}
