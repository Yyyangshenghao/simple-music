import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLyricsStore } from '../../../../stores/lyrics'
import { useSettingsStore } from '../../../../stores/settings'
import { useAmbientStore } from '../../../../stores/ambient'
import { useLyricStyleTuning } from '../../../../stores/lyric-styles'
import { useLightTheme } from '../../../../hooks/useLightTheme'
import { readLyricFrame, subscribeLyricFrames, type LyricFrame } from '../../../../lib/lyric-frame-clock'
import { lyricLineDwellSec } from '../../../../lib/lyric-tempo'
import { buildStyleWords, seededRandom, seedFromText } from '../../../../lib/lyric-style-layouts'
import { parseCssColor, rgbCss, type Rgb } from '../../../../lib/canvas-color'
import {
  compileSonnetProgram, formatTimecode, layoutSonnetShot, sonnetCamera, sonnetGeometry, sonnetShotAt, sonnetWordReveal,
  type SonnetRun, type SonnetShot,
} from '../../../../lib/sonnet-program'
import { useBeatState } from '../shared'
import styles from './SonnetLyrics.module.css'

/**
 * 商籁：印刷感的动态字体 PV（参考 Folia 同名样式重写）。每句一镜，四种字体构图配一层几何线稿与 HUD 读数；
 * 词在开唱时迅速落定，没唱到的字是空心描边，正在唱的词换强调色并拉出下划线。
 * 随拍推镜、交替倾斜，强拍把画面横向撕开几条（推镜裂光）。画面由媒体时间决定，随拍效果读共享的起拍检测。
 */
interface SonnetTuning {
  punch: number
  camera: number
  geometry: boolean
  hud: boolean
  outline: boolean
  glitch: boolean
}

const MONO = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace"

export function SonnetLyrics({ preview = false }: { preview?: boolean }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const inkProbe = useRef<HTMLSpanElement>(null)
  const accentProbe = useRef<HTMLSpanElement>(null)
  const trackKey = useLyricsStore(state => state.trackKey)
  const lines = useLyricsStore(state => state.lines)
  const wordLines = useLyricsStore(state => state.wordLines)
  const translations = useLyricsStore(state => state.translation)
  const currentIndex = useLyricsStore(state => state.currentIndex)
  const showTranslation = useSettingsStore(state => state.lyricsShowTranslation)
  const fontScale = useSettingsStore(state => state.lyricsFontScale)
  const wordMotionEnabled = useSettingsStore(state => state.performance.lyricsWordMotion)
  const appFont = useSettingsStore(state => state.fontFamily)
  const lyricFont = useSettingsStore(state => state.lyricsFontFamily)
  const palette = useAmbientStore(state => state.palette)
  const light = useLightTheme()
  const animated = wordMotionEnabled
  const raw = useLyricStyleTuning('sonnet')
  const tuning = useMemo<SonnetTuning>(() => ({
    punch: Number(raw.punch), camera: Number(raw.camera), geometry: raw.geometry === true,
    hud: raw.hud === true, outline: raw.outline === true, glitch: raw.glitch === true,
  }), [raw])
  const beatState = useBeatState(animated && tuning.punch > 0)
  const [family, setFamily] = useState('system-ui, sans-serif')
  // 字体加载完成后重新排版：之前按回退字体量的宽度会让字挤在一起。
  const [fontsReady, setFontsReady] = useState(0)
  useEffect(() => {
    if (document.fonts?.status !== 'loading') return
    let alive = true
    void document.fonts.ready.then(() => { if (alive) setFontsReady(n => n + 1) })
    return () => { alive = false }
  }, [])
  useEffect(() => {
    const read = () => {
      const host = rootRef.current?.parentElement
      if (host) setFamily(getComputedStyle(host).fontFamily || 'system-ui, sans-serif')
    }
    read()
    const frame = requestAnimationFrame(read)
    return () => cancelAnimationFrame(frame)
  }, [appFont, lyricFont])

  const program = useMemo<SonnetShot[]>(() => {
    const words = lines.map((line, i) => line.text.trim() ? buildStyleWords(line.text, wordLines[i], lyricLineDwellSec(lines, i)) : [])
    return compileSonnetProgram(lines, words, seedFromText(trackKey ?? ''))
  }, [lines, wordLines, trackKey])
  const translation = !preview && showTranslation && currentIndex >= 0 ? translations[currentIndex]?.text?.trim() : ''

  const state = useRef({
    size: { width: 0, height: 0 },
    toneAt: -Infinity,
    ink: [240, 238, 232] as Rgb,
    accent: [255, 150, 210] as Rgb,
    layouts: new Map<string, SonnetRun[]>(),
    signature: '',
  })
  const latest = useRef({ program, tuning, animated, fontScale, family, light, preview, beatState, lineCount: lines.length, withTranslation: !!translation })
  latest.current = { program, tuning, animated, fontScale, family, light, preview, beatState, lineCount: lines.length, withTranslation: !!translation }
  useLayoutEffect(() => { state.current.layouts.clear() }, [program, fontScale, family, fontsReady])

  const draw = useRef<(frame: LyricFrame, force?: boolean) => void>(() => {})
  draw.current = (frame: LyricFrame, force = false) => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    const s = state.current
    const L = latest.current
    const t = L.tuning
    const moving = L.animated
    if (!canvas || !ctx || !s.size.width || !s.size.height) return
    const { width: W, height: H } = s.size
    const ratio = L.preview ? 0.4 : Math.min(2, window.devicePixelRatio || 1)
    if (frame.now - s.toneAt > 400) {
      s.toneAt = frame.now
      s.ink = parseCssColor(inkProbe.current ? getComputedStyle(inkProbe.current).color : '', s.ink)
      s.accent = parseCssColor(accentProbe.current ? getComputedStyle(accentProbe.current).color : '', s.accent)
    }
    const index = sonnetShotAt(L.program, frame.time)
    const shot = index >= 0 ? L.program[index] : undefined
    const localSec = shot ? frame.time - shot.start : 0
    if (!moving) {
      const sung = shot ? shot.words.filter(word => localSec * 1000 >= word.startMs - 80).length : 0
      const singing = shot ? shot.words.findIndex(word => localSec * 1000 >= word.startMs && localSec * 1000 < word.endMs) : -1
      const signature = `${index}|${sung}|${singing}|${s.toneAt}|${W}x${H}|${ratio}|${t.hud ? Math.floor(frame.time) : ''}`
      if (!force && signature === s.signature) return
      s.signature = signature
    } else {
      s.signature = ''
    }
    if (canvas.width !== Math.round(W * ratio) || canvas.height !== Math.round(H * ratio)) {
      canvas.width = Math.round(W * ratio)
      canvas.height = Math.round(H * ratio)
    }
    const { ink, accent } = s
    const paper: Rgb = L.light ? [244, 241, 235] : [12, 12, 15]
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    ctx.globalAlpha = 1
    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = rgbCss(paper, 0.86)
    ctx.fillRect(0, 0, W, H)

    const beat = L.beatState(frame.now)
    const duration = shot ? shot.end - shot.start : 1
    const cam = shot && moving ? sonnetCamera(localSec, duration, beat.pulse, beat.count % 2 ? 1 : -1, t.camera, t.punch) : { scale: 1, rotate: 0, dx: 0 }
    ctx.save()
    ctx.translate(W / 2 + cam.dx * W, H * 0.47)
    ctx.rotate(cam.rotate)
    ctx.scale(cam.scale, cam.scale)

    // 几何线稿：随镜头描出并缓慢转动。
    if (t.geometry && shot) {
      const grow = moving ? 1 - Math.pow(1 - Math.min(1, localSec / 1.1), 3) : 1
      const spin = moving ? localSec * 0.08 : 0
      ctx.lineWidth = 1.1
      const strokes = sonnetGeometry(shot, W, H, grow, spin)
      // 第一笔用强调色单画，其余合成一条路径一次描完。
      strokes.forEach((stroke, i) => {
        if (i <= 1) {
          if (i === 1) ctx.beginPath()
          else {
            ctx.strokeStyle = rgbCss(accent, 0.42)
            ctx.beginPath()
          }
        }
        if (stroke.type === 'circle') {
          const from = stroke.start ?? 0
          ctx.moveTo(stroke.x + Math.cos(from) * Math.max(0, stroke.r), stroke.y + Math.sin(from) * Math.max(0, stroke.r))
          ctx.arc(stroke.x, stroke.y, Math.max(0, stroke.r), from, stroke.end ?? Math.PI * 2)
        } else if (stroke.type === 'ellipse') {
          ctx.moveTo(stroke.x + Math.cos(stroke.rotate) * Math.max(0, stroke.rx), stroke.y + Math.sin(stroke.rotate) * Math.max(0, stroke.rx))
          ctx.ellipse(stroke.x, stroke.y, Math.max(0, stroke.rx), Math.max(0, stroke.ry), stroke.rotate, 0, Math.PI * 2)
        } else {
          stroke.points.forEach(([x, y], n) => n ? ctx.lineTo(x, y) : ctx.moveTo(x, y))
          if (stroke.closed) ctx.closePath()
        }
        if (i === 0) {
          ctx.stroke()
          ctx.strokeStyle = rgbCss(ink, 0.24)
        }
      })
      if (strokes.length > 1) ctx.stroke()
    }

    // 字：开唱时落定；没唱到是空心描边，正在唱换强调色并拉出下划线。
    if (shot) {
      const baseSize = Math.min(Math.max(H * 0.12, 30), 118)
      const key = `${index}|${W}|${H}`
      let runs = s.layouts.get(key)
      if (!runs) {
        const measure = (text: string, size: number) => {
          ctx.font = `900 ${size}px ${L.family}`
          return ctx.measureText(text).width
        }
        runs = layoutSonnetShot(shot, W, H, baseSize, measure, L.preview ? 1 : L.fontScale)
        if (s.layouts.size > 64) s.layouts.clear()
        s.layouts.set(key, runs)
      }
      // 换镜时 0.18 秒从左向右扫入。
      const wipe = moving ? Math.min(1, localSec / 0.18) : 1
      if (wipe < 1) {
        ctx.save()
        ctx.beginPath()
        // 原点在画面中心：右边界从画面左缘外（-0.6W）扫到右缘外（0.6W）。
        const edge = W * (1.2 * wipe - 0.6)
        ctx.rect(-W, -H, W + edge, H * 2)
        ctx.clip()
      }
      ctx.textBaseline = 'middle'
      ctx.textAlign = 'center'
      for (const run of runs) {
        const word = shot.words[run.word]
        const reveal = moving ? sonnetWordReveal(word, localSec * 1000) : { opacity: localSec * 1000 >= word.startMs - 80 ? 1 : 0.55, scale: 1, sung: Math.min(1, Math.max(0, (localSec * 1000 - word.startMs) / Math.max(1, word.endMs - word.startMs))) }
        const started = localSec * 1000 >= word.startMs - 80
        const singing = localSec * 1000 >= word.startMs && localSec * 1000 < word.endMs
        const passed = localSec * 1000 >= word.endMs
        ctx.save()
        ctx.translate(run.x, run.y)
        ctx.rotate(run.rotate)
        ctx.scale(reveal.scale, reveal.scale)
        ctx.font = `900 ${run.size}px ${L.family}`
        const color = singing ? accent : ink
        const paint = (fill: boolean, alpha: number) => {
          ctx.globalAlpha = alpha
          if (fill) ctx.fillStyle = rgbCss(color)
          else {
            ctx.strokeStyle = rgbCss(ink)
            ctx.lineWidth = Math.max(1, run.size * 0.022)
          }
          if (run.vertical) {
            const chars = Array.from(run.text)
            const step = run.size * 0.92
            chars.forEach((char, n) => {
              const y = -((chars.length - 1) * step) / 2 + n * step
              if (fill) ctx.fillText(char, 0, y)
              else ctx.strokeText(char, 0, y)
            })
          } else if (fill) ctx.fillText(run.text, 0, 0)
          else ctx.strokeText(run.text, 0, 0)
        }
        if (!started || !moving) {
          // 未唱：空心描边（关闭描边时淡色实心）。静态模式唱到的字直接实心显示。
          if (started && !moving) paint(true, 1)
          else if (t.outline) paint(false, 0.5)
          else paint(true, 0.25)
        } else {
          paint(true, reveal.opacity * (passed || singing ? 1 : 0.9))
          if (singing || reveal.sung > 0 && !passed) {
            // 下划线（竖排为侧边线）随演唱进度拉出。
            ctx.globalAlpha = 1
            ctx.fillStyle = rgbCss(accent)
            const bar = Math.max(2, run.size * 0.06)
            if (run.vertical) ctx.fillRect(run.width / 2 + bar, -run.height / 2, bar, run.height * reveal.sung)
            else ctx.fillRect(-run.width / 2, run.size * 0.56, run.width * reveal.sung, bar)
          }
        }
        ctx.restore()
      }
      if (wipe < 1) ctx.restore()
    }
    ctx.restore()

    // HUD：四角括线、句号与时间码、本镜进度。避开页头与播放栏。
    if (t.hud) {
      const top = L.preview ? 24 : 104
      const bottom = H - (L.preview ? 24 : 150)
      const left = 28
      const right = W - 28
      const arm = 18
      ctx.globalAlpha = 0.55
      ctx.strokeStyle = rgbCss(ink)
      ctx.lineWidth = 1
      ctx.beginPath()
      for (const [x, y, sx, sy] of [[left, top, 1, 1], [right, top, -1, 1], [left, bottom, 1, -1], [right, bottom, -1, -1]] as const) {
        ctx.moveTo(x, y + sy * arm)
        ctx.lineTo(x, y)
        ctx.lineTo(x + sx * arm, y)
      }
      ctx.stroke()
      ctx.fillStyle = rgbCss(ink)
      ctx.font = `500 11px ${MONO}`
      ctx.textBaseline = 'top'
      ctx.textAlign = 'left'
      const lineNo = shot ? `LINE ${String(shot.lineIndex + 1).padStart(2, '0')}/${String(L.lineCount).padStart(2, '0')}` : 'LINE --/--'
      ctx.fillText(`SONNET  ${lineNo}`, left + 8, top + 8)
      ctx.textAlign = 'right'
      // 静态模式只到秒：画面按秒更新，厘秒会不规律地跳。
      ctx.fillText(moving ? formatTimecode(frame.time) : formatTimecode(frame.time).slice(0, 5), right - 8, top + 8)
      // 窄窗口且有译文时不画底部读数，避免和译文条压在一起。
      if (shot && !(L.withTranslation && W < 1100)) {
        const progress = Math.min(1, Math.max(0, localSec / Math.max(0.1, duration)))
        ctx.globalAlpha = 0.35
        ctx.fillRect(left + 8, bottom - 12, 120, 1)
        ctx.globalAlpha = 0.85
        ctx.fillStyle = rgbCss(accent)
        ctx.fillRect(left + 8, bottom - 13, 120 * progress, 3)
        ctx.fillStyle = rgbCss(ink)
        ctx.globalAlpha = 0.5
        ctx.textAlign = 'right'
        ctx.textBaseline = 'bottom'
        ctx.fillText(`${shot.layout.toUpperCase()} / ${shot.geometry.toUpperCase()}`, right - 8, bottom - 8)
      }
      ctx.globalAlpha = 1
    }

    // 强拍撕裂：把几条横向切片错位复制，像信号撕开一瞬。
    // 只在隔拍的强起拍撕裂，鼓点密的歌也不会每拍都撕。
    if (t.glitch && moving && beat.pulse > 0.6 && beat.count % 2 === 0) {
      const random = seededRandom(beat.count * 7.7)
      const strength = (beat.pulse - 0.6) / 0.4 * t.punch
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.globalAlpha = 1
      for (let i = 0; i < 3; i++) {
        const y = Math.floor(random() * canvas.height * 0.8)
        const h = Math.max(2, Math.floor(canvas.height * (0.02 + random() * 0.05)))
        const dx = Math.round((random() - 0.5) * canvas.width * 0.06 * strength)
        if (dx) ctx.drawImage(canvas, 0, y, canvas.width, h, dx, y, canvas.width, h)
      }
    }
  }

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    const measureSize = () => {
      state.current.size = { width: root.clientWidth, height: root.clientHeight }
      state.current.layouts.clear()
      draw.current(readLyricFrame(), true)
    }
    const observer = new ResizeObserver(measureSize)
    observer.observe(root)
    measureSize()
    return () => observer.disconnect()
  }, [])
  useLayoutEffect(() => { state.current.toneAt = -Infinity }, [light, palette])
  useEffect(() => {
    const timer = setTimeout(() => { state.current.toneAt = -Infinity; draw.current(readLyricFrame(), true) }, 900)
    return () => clearTimeout(timer)
  }, [light, palette])
  useLayoutEffect(() => subscribeLyricFrames(frame => draw.current(frame)), [])
  useLayoutEffect(() => { draw.current(readLyricFrame(), true) })

  return (
    <div ref={rootRef} className={styles.root} style={{ '--lyrics-font-scale': preview ? 1 : fontScale } as React.CSSProperties}>
      <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />
      <span ref={inkProbe} className={`${styles.probe} ${styles.probeInk}`} aria-hidden="true" />
      <span ref={accentProbe} className={`${styles.probe} ${styles.probeAccent}`} aria-hidden="true" />
      <span className={styles.srOnly}>{currentIndex >= 0 ? lines[currentIndex]?.text : ''}</span>
      {translation && <div className={styles.translation}>{translation}</div>}
    </div>
  )
}
