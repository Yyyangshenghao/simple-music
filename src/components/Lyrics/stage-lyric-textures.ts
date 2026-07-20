import * as THREE from 'three'

/**
 * 3D 舞台歌词的 canvas 纹理生成(移植自 Mineradio-MacOS 的
 * makeLyricMask / makeLyricReadabilityTexture / makeLyricGlowTexture / getLyricSunBloomTexture)。
 * 字体跟随应用正文字体(document.body 计算样式),不做原版的字体族/字重/字距自定义。
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
}

let cachedFontStack: string | null = null
function fontStack(): string {
  if (!cachedFontStack) {
    cachedFontStack = (typeof document !== 'undefined' && document.body
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

/**
 * 把一行歌词栅格化为 2048×384 的白字 mask。
 * 字号从 maxFont 逐级降到 minFont 以塞进画布,仍超宽时横向压缩(fitScaleX ≥0.68)。
 */
export function makeLyricMask(text: string, opts?: { maxFont?: number; minFont?: number }): LyricMask {
  const W = 2048
  const H = 384
  const maxFont = opts?.maxFont ?? 128
  const minFont = opts?.minFont ?? 42
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  const maxWidth = W - 190
  text = String(text || '').replace(/\s+/g, ' ').trim()

  let fontSize = maxFont
  let widest = 1
  for (; fontSize >= minFont; fontSize -= 4) {
    ctx.font = fontCss(fontSize)
    widest = Math.max(1, ctx.measureText(text).width)
    if (widest <= maxWidth) break
  }
  ctx.font = fontCss(fontSize)
  widest = Math.max(1, ctx.measureText(text).width)
  let width = Math.min(maxWidth, widest)
  const fitScaleX = widest > maxWidth ? Math.max(0.68, maxWidth / widest) : 1
  if (fitScaleX < 1) width = Math.min(maxWidth, widest * fitScaleX)

  const lineHeight = fontSize
  const y = H / 2 - fontSize / 2 + fontSize * 0.82
  ctx.clearRect(0, 0, W, H)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = '#fff'
  if (fitScaleX < 1) {
    ctx.save()
    ctx.translate(W / 2, 0)
    ctx.scale(fitScaleX, 1)
    ctx.fillText(text, 0, y)
    ctx.restore()
  } else {
    ctx.fillText(text, W / 2, y)
  }

  return {
    texture: makeCanvasTexture(canvas),
    width: W,
    height: H,
    textWidth: width,
    textHeight: fontSize,
    fontSize,
    lineHeight,
    lines: [text],
    fitScaleX,
    textMin: (W / 2 - width / 2) / W,
    textMax: (W / 2 + width / 2) / W
  }
}

/** 黑白描边可读性层:只有文字形状的多层模糊描边,无矩形底板。 */
export function makeReadabilityTexture(mask: LyricMask): THREE.CanvasTexture {
  const { width: W, height: H, fontSize, lines, fitScaleX } = mask
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, W, H)
  ctx.font = fontCss(fontSize)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.miterLimit = 2
  const y0 = H / 2 - fontSize / 2 + fontSize * 0.82

  const strokeLines = (dy: number) => {
    const y = y0 + dy
    if (fitScaleX < 1) {
      ctx.save()
      ctx.translate(W / 2, 0)
      ctx.scale(fitScaleX, 1)
      ctx.strokeText(lines[0], 0, y)
      ctx.restore()
    } else {
      ctx.strokeText(lines[0], W / 2, y)
    }
  }
  const pass = (blur: number, alpha: number, lineWidth: number, color: string, dy = 0) => {
    ctx.save()
    ctx.filter = `blur(${blur}px)`
    ctx.globalAlpha = alpha
    ctx.lineWidth = lineWidth
    ctx.strokeStyle = color
    strokeLines(dy)
    ctx.restore()
  }
  pass(14, 0.18, Math.max(18, fontSize * 0.16), 'rgba(0,0,0,1)', fontSize * 0.018)
  pass(5, 0.32, Math.max(9, fontSize * 0.075), 'rgba(0,0,0,1)', fontSize * 0.012)
  pass(4, 0.15, Math.max(9, fontSize * 0.07), 'rgba(255,255,255,1)')
  pass(1.2, 0.26, Math.max(3.2, fontSize * 0.03), 'rgba(255,255,255,1)')

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
  const text = mask.lines[0]
  const fontSize = mask.fontSize
  const fitScaleX = mask.fitScaleX
  const measuredWidth = Math.max(1, mask.textWidth)
  const padX = Math.max(160, fontSize * 1.45)
  const padY = Math.max(86, fontSize * 0.78)
  const W = Math.ceil(measuredWidth + padX * 2)
  const H = Math.ceil(fontSize + padY * 2)
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, W, H)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.font = fontCss(fontSize)
  const y0 = H / 2 - fontSize / 2 + fontSize * 0.82

  const drawGlowText = (dx: number, dy: number) => {
    const y = y0 + dy
    if (fitScaleX < 1) {
      ctx.save()
      ctx.translate(W / 2 + dx, 0)
      ctx.scale(fitScaleX, 1)
      if (ctx.lineWidth > 0) ctx.strokeText(text, 0, y)
      ctx.fillText(text, 0, y)
      ctx.restore()
    } else {
      if (ctx.lineWidth > 0) ctx.strokeText(text, W / 2 + dx, y)
      ctx.fillText(text, W / 2 + dx, y)
    }
  }
  const pass = (blur: number, alpha: number, lineWidth: number) => {
    ctx.save()
    ctx.filter = `blur(${blur}px)`
    ctx.globalAlpha = alpha
    ctx.fillStyle = '#fff'
    ctx.lineWidth = lineWidth
    ctx.strokeStyle = '#fff'
    drawGlowText(0, 0)
    ctx.restore()
  }
  pass(14, 0.46, Math.max(10, fontSize * 0.1))
  pass(34, 0.34, Math.max(18, fontSize * 0.18))
  pass(78, 0.22, Math.max(28, fontSize * 0.26))
  pass(116, 0.13, Math.max(42, fontSize * 0.4))
  // 环形位移叠印:轮廓向外糊开一圈
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.filter = 'blur(8px)'
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
