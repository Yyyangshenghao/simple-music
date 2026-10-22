import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLyricsStore } from '../../../../stores/lyrics'
import { useSettingsStore } from '../../../../stores/settings'
import { useAmbientStore } from '../../../../stores/ambient'
import { useLyricStyleTuning } from '../../../../stores/lyric-styles'
import { useLightTheme } from '../../../../hooks/useLightTheme'
import { useReducedMotion } from '../../../../hooks/useReducedMotion'
import { readLyricFrame, subscribeLyricFrames, type LyricFrame } from '../../../../lib/lyric-frame-clock'
import { lyricLineDwellSec } from '../../../../lib/lyric-tempo'
import { buildStyleWords, seedFromText } from '../../../../lib/lyric-style-layouts'
import {
  buildFumeArticle, cameraSettled, fumeCameraTarget, fumeDecor, printedGlyphs, stepFumeCamera,
  type FumeArticle, type FumeCamera, type FumeDecor,
} from '../../../../lib/fume-article'
import styles from './FumeLyrics.module.css'

/**
 * 浮名：整首歌词排成一篇双栏文章，镜头在文章里推移、对准正在唱的句子。
 * 当前句随演唱逐字“打印”成强调色，打印位置有一块光标；唱过的句子慢慢褪成纸面上的余迹，
 * 还没唱到的句子以浅影铺在文章里。Canvas2D 绘制：缩放平移不重排文字，只重画可见的几行。
 */
const SERIF = "'Songti SC', 'STSong', 'Noto Serif CJK SC', 'Source Han Serif SC', 'Noto Serif SC', serif"
const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

interface FumeTuning {
  zoom: number
  float: number
  hold: number
  cursor: boolean
  decor: boolean
  serif: boolean
}

interface Palette {
  primary: string
  accent: string
}

/** 读出探针上真实生效的颜色（CSS 变量经 color-mix 解析后），给 Canvas 使用；探针颜色写在 CSS 里，只读不写。 */
function readColor(probe: HTMLElement | null, fallback: string): string {
  return probe ? getComputedStyle(probe).color || fallback : fallback
}

function drawDecor(ctx: CanvasRenderingContext2D, decor: readonly FumeDecor[]): void {
  ctx.beginPath()
  for (const item of decor) {
    if (item.kind === 'line') {
      ctx.moveTo(item.x0, item.y0)
      ctx.lineTo(item.x1, item.y1)
    } else if (item.kind === 'arc') {
      ctx.moveTo(item.x + Math.cos(item.start) * item.r, item.y + Math.sin(item.start) * item.r)
      ctx.arc(item.x, item.y, item.r, item.start, item.end)
    } else {
      // 四角星：外角与内凹点交替。
      for (let i = 0; i <= 8; i++) {
        const angle = item.rotate + (i * Math.PI) / 4
        const radius = i % 2 ? item.r * 0.32 : item.r
        const x = item.x + Math.cos(angle) * radius
        const y = item.y + Math.sin(angle) * radius
        if (i) ctx.lineTo(x, y)
        else ctx.moveTo(x, y)
      }
    }
  }
  ctx.stroke()
}

export function FumeLyrics({ preview = false }: { preview?: boolean }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const primaryProbe = useRef<HTMLSpanElement>(null)
  const accentProbe = useRef<HTMLSpanElement>(null)
  const trackKey = useLyricsStore(state => state.trackKey)
  const lines = useLyricsStore(state => state.lines)
  const wordLines = useLyricsStore(state => state.wordLines)
  const translations = useLyricsStore(state => state.translation)
  const currentIndex = useLyricsStore(state => state.currentIndex)
  const showTranslation = useSettingsStore(state => state.lyricsShowTranslation)
  const fontScale = useSettingsStore(state => state.lyricsFontScale)
  const wordMotion = useSettingsStore(state => state.performance.lyricsWordMotion)
  const palette = useAmbientStore(state => state.palette)
  const light = useLightTheme()
  const reducedMotion = useReducedMotion()
  const animated = wordMotion && !reducedMotion
  const raw = useLyricStyleTuning('fume')
  const tuning = useMemo<FumeTuning>(() => ({
    zoom: Number(raw.zoom), float: Number(raw.float), hold: Number(raw.hold),
    cursor: raw.cursor === true, decor: raw.decor === true, serif: raw.serif === true,
  }), [raw])
  const [fontsReady, setFontsReady] = useState(0)
  // 非衬线时用歌词页实际生效的字体（含用户在设置里选的歌词字体）；从外层读，本层会被设成衬线。
  const [sansFamily, setSansFamily] = useState('system-ui, sans-serif')
  useLayoutEffect(() => {
    const host = rootRef.current?.parentElement
    if (host) setSansFamily(getComputedStyle(host).fontFamily || 'system-ui, sans-serif')
  }, [])

  // 字体就绪后重排一次：度量依赖实际字形。
  useEffect(() => {
    if (document.fonts?.status !== 'loading') return
    let alive = true
    void document.fonts.ready.then(() => { if (alive) setFontsReady(n => n + 1) })
    return () => { alive = false }
  }, [])

  const family = tuning.serif ? SERIF : sansFamily
  const article = useMemo<FumeArticle | null>(() => {
    if (typeof document === 'undefined') return null
    const ctx = document.createElement('canvas').getContext('2d')
    if (!ctx) return null
    const cache = new Map<string, number>()
    const measure = (text: string, size: number) => {
      const key = `${size}|${text}`
      let width = cache.get(key)
      if (width === undefined) {
        ctx.font = `700 ${size}px ${family}`
        // 逐字位置按单字宽度累加，度量与绘制都关掉字距调整，整行与逐字才能对齐。
        ctx.fontKerning = 'none'
        width = ctx.measureText(text).width
        cache.set(key, width)
      }
      return width
    }
    return buildFumeArticle(lines, measure, seedFromText(trackKey ?? ''))
  // fontsReady 只用来在字体加载完成后触发重排。
  }, [lines, trackKey, family, fontsReady])
  const decor = useMemo(() => article ? fumeDecor(article, seedFromText(trackKey ?? '')) : [], [article, trackKey])

  // 当前句的逐词时序：打印进度按演唱时间推进。
  const words = useMemo(() => {
    const line = currentIndex >= 0 ? lines[currentIndex] : undefined
    return line?.text.trim() ? buildStyleWords(line.text, wordLines[currentIndex], lyricLineDwellSec(lines, currentIndex)) : []
  }, [lines, wordLines, currentIndex])

  // 绘制状态放在 ref 里，帧回调读取最新值，不随重渲染重新订阅。
  const state = useRef({
    camera: null as FumeCamera | null, lastNow: 0, lastIndex: -2, settleRaf: 0, paletteAt: -Infinity,
    size: { width: 0, height: 0 }, palette: { primary: '#fff', accent: '#f6c' } as Palette,
  })
  const latest = useRef({ article, decor, words, tuning, animated, fontScale, family, currentIndex, lines, preview })
  latest.current = { article, decor, words, tuning, animated, fontScale, family, currentIndex, lines, preview }

  const draw = useRef<(frame: LyricFrame) => void>(() => {})
  draw.current = (frame: LyricFrame) => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    const s = state.current
    const { article: art, decor: decorShapes, words: lineWords, tuning: t, animated: moving, fontScale: scaleSetting, family: font, currentIndex: index, lines: allLines } = latest.current
    if (!canvas || !ctx || !art || !s.size.width || !s.size.height) return
    const { width, height } = s.size
    // 配色随主题和封面过渡，隔一会儿重读一次解析后的颜色。
    if (frame.now - s.paletteAt > 400) {
      s.paletteAt = frame.now
      s.palette = { primary: readColor(primaryProbe.current, s.palette.primary), accent: readColor(accentProbe.current, s.palette.accent) }
    }
    const ratio = latest.current.preview ? 0.4 : Math.min(2, window.devicePixelRatio || 1)
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
      canvas.width = Math.round(width * ratio)
      canvas.height = Math.round(height * ratio)
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // 镜头：平滑追向当前句；跳句（拖动）、首帧或静态模式直接到位。
    const displaySize = Math.min(Math.max(height * 0.1, 28), 96) * (latest.current.preview ? 1 : scaleSetting) * t.zoom
    const target = fumeCameraTarget(art, index, { width, height }, displaySize)
    if (!target) return
    const dt = s.lastNow ? Math.min(0.1, (frame.now - s.lastNow) / 1000) : 0
    s.lastNow = frame.now
    const jumped = s.lastIndex !== -2 && Math.abs(index - s.lastIndex) > 2
    s.lastIndex = index
    s.camera = !s.camera || !moving || jumped ? target : stepFumeCamera(s.camera, target, dt)
    const camera = s.camera
    // 播放时镜头轻微漂浮，像手持跟拍。
    const drift = moving && frame.running ? t.float : 0
    const floatX = Math.sin(frame.now / 2300) * 10 * drift
    const floatY = Math.cos(frame.now / 3100) * 7 * drift
    const centerY = height * 0.44
    ctx.setTransform(ratio * camera.scale, 0, 0, ratio * camera.scale,
      ratio * (width / 2 - camera.x * camera.scale + floatX), ratio * (centerY - camera.y * camera.scale + floatY))

    const { primary, accent } = s.palette
    if (t.decor && decorShapes.length) {
      ctx.globalAlpha = 0.22
      ctx.strokeStyle = accent
      ctx.lineWidth = 1.1 / camera.scale
      drawDecor(ctx, decorShapes)
    }

    // 只画视野内的行。
    const view = { x0: camera.x - (width / 2 + 40) / camera.scale, x1: camera.x + (width / 2 + 40) / camera.scale,
      y0: camera.y - (centerY + 60) / camera.scale, y1: camera.y + (height - centerY + 60) / camera.scale }
    const elapsed = index >= 0 ? frame.time * 1000 - (allLines[index]?.time ?? 0) * 1000 : 0
    const printed = printedGlyphs(lineWords, elapsed)
    const holdLevel = 0.12 + 0.5 * t.hold
    ctx.textBaseline = 'alphabetic'
    ctx.fontKerning = 'none'
    for (const row of art.rows) {
      if (row.x > view.x1 || row.x + row.width < view.x0 || row.y - row.size > view.y1 || row.y + row.size < view.y0) continue
      ctx.font = `700 ${row.size}px ${font}`
      if (row.lineIndex !== index) {
        let alpha = 0.13
        if (row.lineIndex < index) {
          // 唱过的句子：先保持清晰，约 3 秒内褪到保留亮度。
          const end = (allLines[row.lineIndex + 1]?.time ?? allLines[row.lineIndex].time) * 1000
          alpha = holdLevel + (0.82 - holdLevel) * (1 - clamp01((frame.time * 1000 - end) / 3000))
          if (!moving) alpha = Math.max(alpha, 0.45)
        }
        ctx.globalAlpha = alpha
        ctx.fillStyle = primary
        ctx.shadowBlur = 0
        ctx.fillText(row.text, row.x, row.y)
        continue
      }
      // 当前句：未打印的字是浅影，已打印的强调色并发光，最后一个字随进度淡入。
      ctx.globalAlpha = moving ? 0.16 : 0.85
      ctx.fillStyle = primary
      ctx.shadowBlur = 0
      ctx.fillText(row.text, row.x, row.y)
      ctx.fillStyle = accent
      ctx.shadowColor = accent
      // 发光半径设上限：字号和镜头再大，模糊开销也不跟着无限增长。
      ctx.shadowBlur = moving ? Math.min(24 * ratio, row.size * 0.3 * camera.scale * ratio) : 0
      // 已打完的字合成一次绘制，只有正在落下的那个字单独淡入，每行最多两次带阴影的绘制。
      let visible = row.visibleStart
      let full = 0
      let falling = -1
      let ink = 0
      for (let g = 0; g < row.glyphs.length; g++) {
        if (/\s/.test(row.glyphs[g].char)) { if (falling < 0 && full === g) full = g + 1; continue }
        const amount = clamp01(printed - visible)
        visible++
        if (amount >= 1) { full = g + 1; continue }
        if (amount > 0) { falling = g; ink = amount }
        break
      }
      if (full > 0) {
        ctx.globalAlpha = 1
        ctx.fillText(row.glyphs.slice(0, full).map(glyph => glyph.char).join(''), row.x, row.y)
      }
      if (falling >= 0) {
        ctx.globalAlpha = ink
        ctx.fillText(row.glyphs[falling].char, row.x + row.glyphs[falling].x, row.y)
      }
      ctx.shadowBlur = 0
      const glyphEnd = (g: number) => row.glyphs[g + 1]?.x ?? row.width
      const cursorX = row.x + (falling >= 0 ? row.glyphs[falling].x + (glyphEnd(falling) - row.glyphs[falling].x) * ink : full > 0 ? glyphEnd(full - 1) : 0)
      const rowEnd = row.visibleStart + row.glyphs.filter(glyph => !/\s/.test(glyph.char)).length
      if (t.cursor && moving && printed >= row.visibleStart && printed < rowEnd && (printed > row.visibleStart || index === row.lineIndex && elapsed > 0)) {
        ctx.globalAlpha = 0.85
        ctx.fillRect(cursorX + row.size * 0.06, row.y - row.size * 0.86, row.size * 0.56, row.size * 0.98)
      }
    }
    ctx.globalAlpha = 1

    // 暂停时帧时钟不再推送：自己补几帧让镜头停稳。
    if (!frame.running && moving && !cameraSettled(camera, target) && !s.settleRaf) {
      s.settleRaf = requestAnimationFrame(now => {
        s.settleRaf = 0
        draw.current({ ...readLyricFrame(), now })
      })
    }
  }

  // 换主题或封面配色时立刻重读颜色（下面每次渲染后的重画会用上）。
  useLayoutEffect(() => { state.current.paletteAt = -Infinity }, [light, palette])
  // 封面配色是逐步过渡的（约 0.8s）：暂停时没有新帧，过渡结束后再补画一次。
  useEffect(() => {
    const timer = setTimeout(() => { state.current.paletteAt = -Infinity; draw.current(readLyricFrame()) }, 900)
    return () => clearTimeout(timer)
  }, [light, palette])
  // 换歌（文章重排）时镜头直接到位，不从上一首的坐标滑过来。
  useLayoutEffect(() => { state.current.camera = null; state.current.lastIndex = -2 }, [article])
  // 舞台尺寸变化时更新画布，然后按当前时间重画。
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    const measureSize = () => {
      state.current.size = { width: root.clientWidth, height: root.clientHeight }
      draw.current(readLyricFrame())
    }
    const observer = new ResizeObserver(measureSize)
    observer.observe(root)
    measureSize()
    return () => observer.disconnect()
  }, [])
  useLayoutEffect(() => subscribeLyricFrames(frame => draw.current(frame)), [])
  useLayoutEffect(() => { draw.current(readLyricFrame()) })
  useEffect(() => () => cancelAnimationFrame(state.current.settleRaf), [])

  const translation = !preview && showTranslation && currentIndex >= 0 ? translations[currentIndex]?.text?.trim() : ''
  return (
    <div ref={rootRef} className={styles.root} style={{ fontFamily: tuning.serif ? SERIF : undefined, '--lyrics-font-scale': preview ? 1 : fontScale } as React.CSSProperties}>
      <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />
      <span ref={primaryProbe} className={`${styles.probe} ${styles.probePrimary}`} aria-hidden="true" />
      <span ref={accentProbe} className={`${styles.probe} ${styles.probeAccent}`} aria-hidden="true" />
      {/* 屏幕阅读器读当前句；画布只是视觉呈现。 */}
      <span className={styles.srOnly} aria-live="off">{currentIndex >= 0 ? lines[currentIndex]?.text : ''}</span>
      {translation && <div className={styles.translation}>{translation}</div>}
    </div>
  )
}
