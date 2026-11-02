import { useEffect, useRef } from 'react'
import { api } from '../../../../lib/api'
import { sizedImage, CANVAS_COVER_PX } from '../../../../lib/image-size'
import { usePlayerStore } from '../../../../stores/player'
import { useSettingsStore } from '../../../../stores/settings'
import { useCoverLyricPalette } from '../../../../hooks/useCoverLyricPalette'
import { useBeatState, useLyricFrames, useStyleLine } from '../shared'
import styles from './ParticlePreview.module.css'

/** 画布像素：预览框约 300px 宽，按 2 倍屏取整，够清楚也足够轻。 */
const W = 600
const H = 375
/** 封面采样成 GRID×GRID 个点，对应粒光舞台里的封面粒子。 */
const GRID = 44
const COVER_SIZE = H * 0.84
const FALLBACK_FONT = "-apple-system, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif"

interface Dot { x: number; y: number; r: number; g: number; b: number; lum: number; seed: number }

function sampleCover(img: HTMLImageElement): Dot[] | null {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = GRID
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  try {
    ctx.drawImage(img, 0, 0, GRID, GRID)
    const data = ctx.getImageData(0, 0, GRID, GRID).data
    const dots: Dot[] = []
    for (let i = 0; i < GRID * GRID; i++) {
      const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2]
      dots.push({ x: i % GRID, y: Math.floor(i / GRID), r, g, b, lum: (0.299 * r + 0.587 * g + 0.114 * b) / 255, seed: Math.sin(i * 12.9898) * 43758.5453 % 1 })
    }
    return dots
  } catch {
    // 跨域污染等读不到像素时退回示意点阵。
    return null
  }
}

/** 没有封面时的占位点阵：中间亮、四周暗的一团。 */
function placeholderDots(): Dot[] {
  return Array.from({ length: GRID * GRID }, (_, i) => {
    const x = i % GRID, y = Math.floor(i / GRID)
    const d = Math.hypot(x / GRID - 0.5, y / GRID - 0.45)
    const lum = Math.max(0.08, 0.75 - d * 1.4)
    return { x, y, r: 200, g: 220, b: 255, lum, seed: Math.abs(Math.sin(i * 12.9898) * 43758.5453 % 1) }
  })
}

/**
 * 粒光的缩略预览：粒光是整屏 WebGL 场景，同屏只跑一个，这里用 2D 点阵仿出它的观感——
 * 封面化作随拍呼吸的光点，当前句按演唱进度从暗到亮。只在帧时钟推送时绘制，暂停即停。
 */
export function ParticlePreview() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dotsRef = useRef<Dot[]>(placeholderDots())
  const coverUrl = usePlayerStore(state => state.currentTrack?.cover)
  const palette = useCoverLyricPalette(coverUrl)
  const westernFont = useSettingsStore(state => state.lyrics3dFontFamily)
  const cjkFont = useSettingsStore(state => state.lyrics3dFontFamilyCjk)
  const line = useStyleLine(true)
  const beat = useBeatState(true)
  const lastRef = useRef({ elapsed: 0, now: 0 })

  const draw = (elapsedMs: number, now: number) => {
    lastRef.current = { elapsed: elapsedMs, now }
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const ink = getComputedStyle(canvas).getPropertyValue('--lyrics-ink-rgb').trim() || '255, 255, 255'
    const { pulse } = beat(now)
    const t = now / 1000
    ctx.clearRect(0, 0, W, H)

    const step = COVER_SIZE / GRID
    const left = (W - COVER_SIZE) / 2
    const top = (H - COVER_SIZE) / 2
    for (const dot of dotsRef.current) {
      const wave = Math.sin(t * 0.9 + dot.x * 0.35 + dot.y * 0.22 + dot.seed * 6)
      const twinkle = 0.75 + 0.25 * Math.sin(t * 2.2 + dot.seed * 40)
      const radius = step * (0.16 + dot.lum * 0.34) * (1 + pulse * 0.35 * dot.lum)
      const alpha = Math.min(1, (0.18 + dot.lum * 0.82) * twinkle * (0.85 + pulse * 0.3))
      ctx.fillStyle = `rgba(${dot.r}, ${dot.g}, ${dot.b}, ${alpha.toFixed(3)})`
      ctx.beginPath()
      ctx.arc(left + (dot.x + 0.5) * step + wave * 1.4, top + (dot.y + 0.5) * step + wave * 2.2, radius, 0, Math.PI * 2)
      ctx.fill()
    }

    if (!line.text) return
    const families = [westernFont, cjkFont].filter(Boolean).map(name => `"${name}"`).join(', ')
    let size = 46
    ctx.font = `600 ${size}px ${families ? `${families}, ` : ''}${FALLBACK_FONT}`
    const width = ctx.measureText(line.text).width
    if (width > W * 0.86) {
      size = Math.max(22, Math.floor(size * (W * 0.86) / width))
      ctx.font = `600 ${size}px ${families ? `${families}, ` : ''}${FALLBACK_FONT}`
    }
    const textWidth = ctx.measureText(line.text).width
    const x = (W - textWidth) / 2
    const y = H * 0.5
    const progress = line.dwellSec > 0 ? Math.min(1, Math.max(0, elapsedMs / (line.dwellSec * 1000))) : 1
    ctx.textBaseline = 'middle'
    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)'
    ctx.shadowBlur = 14
    ctx.fillStyle = `rgba(${ink}, 0.38)`
    ctx.fillText(line.text, x, y)
    ctx.save()
    ctx.beginPath()
    ctx.rect(x - 4, 0, textWidth * progress + 4, H)
    ctx.clip()
    ctx.shadowColor = palette.glowColor || palette.secondary || palette.highlight
    ctx.shadowBlur = 18 + pulse * 14
    ctx.fillStyle = palette.highlight || `rgb(${ink})`
    ctx.fillText(line.text, x, y)
    ctx.restore()
    ctx.shadowBlur = 0
  }

  useLyricFrames(line.lineStartMs, draw)

  useEffect(() => {
    if (!coverUrl) {
      dotsRef.current = placeholderDots()
      draw(lastRef.current.elapsed, performance.now())
      return
    }
    let cancelled = false
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      if (cancelled) return
      dotsRef.current = sampleCover(img) ?? placeholderDots()
      draw(lastRef.current.elapsed, performance.now())
    }
    img.src = api.coverImage(sizedImage(coverUrl, CANVAS_COVER_PX))
    return () => { cancelled = true; img.onload = null }
    // draw 每次渲染都是新的闭包；这里只在换封面时重新采样。
  }, [coverUrl])

  return <canvas ref={canvasRef} className={styles.canvas} width={W} height={H} aria-hidden="true" />
}
