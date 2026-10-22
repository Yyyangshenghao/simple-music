import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLyricsStore } from '../../../../stores/lyrics'
import { useSettingsStore } from '../../../../stores/settings'
import { useAmbientStore } from '../../../../stores/ambient'
import { useLyricStyleTuning } from '../../../../stores/lyric-styles'
import { useReducedMotion } from '../../../../hooks/useReducedMotion'
import { readLyricFrame, subscribeLyricFrames, type LyricFrame } from '../../../../lib/lyric-frame-clock'
import { lyricLineDwellSec } from '../../../../lib/lyric-tempo'
import { buildStyleWords, seededRandom, seedFromText, type StyleWord } from '../../../../lib/lyric-style-layouts'
import { mixRgb, parseCssColor, rgbCss, type Rgb } from '../../../../lib/canvas-color'
import {
  activeShots, beamIntensity, beamPose, buildLumiereShots, glyphDrift, glyphRevealTimes, lumiereAmbient, lumiereLineArt,
  sparkleEnvelope, windowSlot, wrap01, type LumiereShot,
} from '../../../../lib/lumiere-scene'
import styles from './LumiereLyrics.module.css'

/**
 * 绘光：舞台光 PV（参考 Folia 同名样式重写）。暗场里几束光柱缓慢扫动，烟、星点、浮尘与细线稿铺底；
 * 当前句居中逐字点亮，唱到的字带一记四芒闪点，被光柱照到的字更亮并垫一层柔光；
 * 上一句化作余光逐渐崩解飘散，下一句是未点亮的刻字从散开处聚拢。画面只由媒体时间决定。
 */
const SERIF = "'Songti SC', 'STSong', 'Noto Serif CJK SC', 'Source Han Serif SC', 'Noto Serif SC', serif"
const WARM: Rgb = [255, 244, 226]
const DIM: Rgb = [150, 160, 185]

interface LumiereTuning {
  beams: number
  drift: number
  sparkle: boolean
  lineArt: boolean
  serif: boolean
  bokeh: boolean
}

interface LineLayout {
  /** x 为所在行内的左端；row 为折行后的行号 */
  glyphs: { char: string; x: number; width: number; rotate: number; lift: number; row: number }[]
  /** 每行宽度 */
  rows: number[]
  size: number
}

/** 柔光精灵：白色径向渐变，按需着色后叠加，比 shadowBlur 便宜得多。 */
function glowSprite(color: Rgb): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 64
  const ctx = canvas.getContext('2d')!
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
  gradient.addColorStop(0, rgbCss(color, 0.9))
  gradient.addColorStop(0.4, rgbCss(color, 0.35))
  gradient.addColorStop(1, rgbCss(color, 0))
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 64, 64)
  return canvas
}

export function LumiereLyrics({ preview = false }: { preview?: boolean }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const accentProbe = useRef<HTMLSpanElement>(null)
  const accent2Probe = useRef<HTMLSpanElement>(null)
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
  const reducedMotion = useReducedMotion()
  const animated = wordMotionEnabled && !reducedMotion
  const raw = useLyricStyleTuning('lumiere')
  const tuning = useMemo<LumiereTuning>(() => ({
    beams: Number(raw.beams), drift: Number(raw.drift), sparkle: raw.sparkle === true,
    lineArt: raw.lineArt === true, serif: raw.serif === true, bokeh: raw.bokeh === true,
  }), [raw])
  const [sansFamily, setSansFamily] = useState('system-ui, sans-serif')
  useEffect(() => {
    const read = () => {
      const host = rootRef.current?.parentElement
      if (host) setSansFamily(getComputedStyle(host).fontFamily || 'system-ui, sans-serif')
    }
    read()
    const frame = requestAnimationFrame(read)
    return () => cancelAnimationFrame(frame)
  }, [appFont, lyricFont])
  const family = tuning.serif ? SERIF : sansFamily

  const seed = seedFromText(trackKey ?? '')
  const shots = useMemo<LumiereShot[]>(() => buildLumiereShots(lines, seed), [lines, seed])
  const ambient = useMemo(() => lumiereAmbient(seed), [seed])
  const lineArts = useMemo(() => new Map(shots.map(shot => [shot, lumiereLineArt(shot)])), [shots])
  // 各句逐字时序在用到时才算（只排当前句附近几行）。
  const wordsCache = useMemo(() => new Map<number, StyleWord[]>(), [lines, wordLines])
  const wordsOf = (index: number) => {
    let words = wordsCache.get(index)
    if (!words) {
      const line = lines[index]
      words = line?.text.trim() ? buildStyleWords(line.text, wordLines[index], lyricLineDwellSec(lines, index)) : []
      wordsCache.set(index, words)
    }
    return words
  }
  const translation = !preview && showTranslation && currentIndex >= 0 ? translations[currentIndex]?.text?.trim() : ''

  const state = useRef({
    size: { width: 0, height: 0 },
    toneAt: -Infinity,
    accent: [255, 200, 120] as Rgb,
    accent2: [60, 70, 140] as Rgb,
    sprites: new Map<string, HTMLCanvasElement>(),
    layouts: new Map<string, LineLayout>(),
    signature: '',
  })
  const latest = useRef({ shots, ambient, lineArts, tuning, animated, fontScale, family, preview, lines, currentIndex, wordsOf, seed })
  latest.current = { shots, ambient, lineArts, tuning, animated, fontScale, family, preview, lines, currentIndex, wordsOf, seed }
  useLayoutEffect(() => { state.current.layouts.clear() }, [lines, fontScale, family, seed])

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
    const index = L.currentIndex
    const time = frame.time
    if (frame.now - s.toneAt > 400) {
      s.toneAt = frame.now
      const accent = parseCssColor(accentProbe.current ? getComputedStyle(accentProbe.current).color : '', s.accent)
      s.accent2 = parseCssColor(accent2Probe.current ? getComputedStyle(accent2Probe.current).color : '', s.accent2)
      // 柔光贴图按颜色缓存，颜色真的变了才重建。
      if (accent.some((value, i) => value !== s.accent[i])) s.sprites.clear()
      s.accent = accent
    }
    const lineStart = (i: number) => (L.lines[i]?.time ?? 0)
    const sinceSwitch = index >= 0 ? time - lineStart(index) : 10
    // 静态模式：画面只随换句、点亮字数与配色尺寸变化。
    if (!moving) {
      const lit = index >= 0 ? glyphRevealTimes(L.wordsOf(index)).filter(g => (time - lineStart(index)) * 1000 >= g.start).length : 0
      const signature = `${index}|${lit}|${s.toneAt}|${W}x${H}|${ratio}`
      if (!force && signature === s.signature) return
      s.signature = signature
    } else {
      s.signature = ''
    }
    if (canvas.width !== Math.round(W * ratio) || canvas.height !== Math.round(H * ratio)) {
      canvas.width = Math.round(W * ratio)
      canvas.height = Math.round(H * ratio)
    }
    const sprite = (color: Rgb) => {
      const key = color.join(',')
      let made = s.sprites.get(key)
      if (!made) { made = glowSprite(color); s.sprites.set(key, made) }
      return made
    }
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
    // 暗场：始终是暗的舞台，带一点封面色。
    ctx.fillStyle = rgbCss(mixRgb(s.accent2, [5, 6, 12], 0.14))
    ctx.fillRect(0, 0, W, H)
    const clock = moving ? time : 0
    // 静态模式不做光位交叉渐变，只用当前光位。
    const rigs = moving ? activeShots(L.shots, time) : activeShots(L.shots, time).slice(-1).map(rig => ({ ...rig, weight: 1 }))

    // 烟：每个光位几团缓慢漂移的雾。
    for (const { shot, weight } of rigs) {
      const random = seededRandom(shot.seed + 3)
      for (let i = 0; i < 3; i++) {
        const x = (random() + Math.sin(clock * 0.05 + i) * 0.05) * W
        const y = (0.2 + random() * 0.6) * H
        const r = (0.3 + random() * 0.3) * H
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, r)
        gradient.addColorStop(0, rgbCss(mixRgb(s.accent, s.accent2, 0.3), 0.08 * weight))
        gradient.addColorStop(1, rgbCss(s.accent2, 0))
        ctx.fillStyle = gradient
        ctx.fillRect(x - r, y - r, r * 2, r * 2)
      }
    }
    // 星点：轻微闪烁。
    if (t.lineArt) {
      ctx.fillStyle = rgbCss(WARM)
      for (const star of L.ambient.stars) {
        ctx.globalAlpha = 0.25 + 0.25 * Math.sin(clock * star.speed + star.phase)
        ctx.fillRect(star.x * W, star.y * H, star.size, star.size)
      }
      ctx.globalAlpha = 1
    }
    // 光柱：叠加混合，沿光束方向渐隐，中间再叠一条更窄的芯。
    ctx.globalCompositeOperation = 'lighter'
    for (const { shot, weight, age } of rigs) {
      for (const beam of shot.beams) {
        const { angle, reach } = beamPose(beam, age, moving)
        const sx = beam.x * W
        const sy = beam.y * H
        const length = H * 2.2 * reach
        if (length < 1) continue
        const color = beam.warm ? mixRgb(WARM, s.accent, 0.7) : s.accent
        for (const [narrow, strength] of [[1, 0.2], [0.35, 0.16]] as const) {
          const half0 = beam.width * H * narrow
          const half1 = half0 + length * Math.tan(beam.spread) * narrow
          const nx = -Math.sin(angle)
          const ny = Math.cos(angle)
          const ex = sx + Math.cos(angle) * length
          const ey = sy + Math.sin(angle) * length
          const gradient = ctx.createLinearGradient(sx, sy, ex, ey)
          gradient.addColorStop(0, rgbCss(color, Math.min(1, strength * beam.power * weight * t.beams)))
          gradient.addColorStop(1, rgbCss(color, 0))
          ctx.fillStyle = gradient
          ctx.beginPath()
          ctx.moveTo(sx + nx * half0, sy + ny * half0)
          ctx.lineTo(ex + nx * half1, ey + ny * half1)
          ctx.lineTo(ex - nx * half1, ey - ny * half1)
          ctx.lineTo(sx - nx * half0, sy - ny * half0)
          ctx.closePath()
          ctx.fill()
        }
      }
    }
    ctx.globalCompositeOperation = 'source-over'
    const lightAt = (x: number, y: number) => rigs.reduce((sum, { shot, weight, age }) => sum + beamIntensity(shot.beams, age, moving, x, y, W, H, weight), 0) * t.beams
    // 细线稿：随光位描出来。
    if (t.lineArt) {
      ctx.lineWidth = 1.2
      for (const { shot, weight, age } of rigs) {
        const draw = moving ? Math.min(1, age / 1.5) : 1
        ctx.strokeStyle = rgbCss(mixRgb(s.accent2, WARM, 0.6), 0.3 * weight)
        for (const art of L.lineArts.get(shot) ?? []) {
          const x = art.x * W
          const y = art.y * H
          const r = art.r * H
          ctx.beginPath()
          if (art.kind === 'circle') {
            ctx.arc(x, y, r, 0, Math.PI * 2 * draw)
            if (art.filled && draw >= 1) {
              ctx.fillStyle = rgbCss(s.accent2, 0.22 * weight)
              ctx.fill()
            }
          } else if (art.kind === 'triangle') {
            const points = [0, 1, 2, 3].map(i => [x + Math.cos(art.rotate + (i * Math.PI * 2) / 3) * r, y + Math.sin(art.rotate + (i * Math.PI * 2) / 3) * r])
            const segments = draw * 3
            ctx.moveTo(points[0][0], points[0][1])
            for (let i = 1; i <= 3; i++) {
              const k = Math.min(1, Math.max(0, segments - (i - 1)))
              if (k <= 0) break
              ctx.lineTo(points[i - 1][0] + (points[i][0] - points[i - 1][0]) * k, points[i - 1][1] + (points[i][1] - points[i - 1][1]) * k)
            }
          } else {
            ctx.arc(x, y, r * 0.5, 0, Math.PI * 2 * draw)
            for (let i = 0; i < 8; i++) {
              const a = (i * Math.PI) / 4
              ctx.moveTo(x + Math.cos(a) * r * 0.75, y + Math.sin(a) * r * 0.75)
              ctx.lineTo(x + Math.cos(a) * r * (0.75 + 0.35 * draw), y + Math.sin(a) * r * (0.75 + 0.35 * draw))
            }
          }
          ctx.stroke()
        }
      }
      // 浮尘：被光柱照到时亮起来。
      ctx.fillStyle = rgbCss(WARM)
      for (const mote of L.ambient.motes) {
        const x = wrap01(mote.x + mote.vx * clock) * W
        const y = wrap01(mote.y + mote.vy * clock) * H
        ctx.globalAlpha = Math.min(1, 0.1 + lightAt(x, y) * 0.8)
        ctx.beginPath()
        ctx.arc(x, y, mote.size, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1
    }

    // 歌词窗口：当前句前后三句。
    const baseSize = Math.min(Math.max(H * 0.085, 26), 84) * (L.preview ? 1 : L.fontScale)
    const font = L.family
    const layoutOf = (i: number): LineLayout | null => {
      const key = `${i}|${W}|${H}`
      let layout = s.layouts.get(key)
      if (layout) return layout
      const text = L.lines[i]?.text.replace(/\s+/g, ' ').trim()
      if (!text) return null
      ctx.font = `700 ${baseSize}px ${font}`
      const random = seededRandom(L.seed + i * 13.7)
      const measured = Array.from(text).map(char => ({ char, width: ctx.measureText(char).width, rotate: (random() - 0.5) * 0.12, lift: (random() - 0.5) * 0.12 }))
      const natural = measured.reduce((sum, g) => sum + g.width, 0)
      const maxWidth = W * 0.86
      // 太长时先缩小，缩到 0.62 倍仍放不下就折行，字不会小到读不了。
      const k = Math.max(0.62, Math.min(1, maxWidth / Math.max(1, natural)))
      const rows: number[] = [0]
      const glyphs = measured.map(g => {
        const width = g.width * k
        if (rows[rows.length - 1] + width > maxWidth && rows[rows.length - 1] > 0) rows.push(0)
        const glyph = { ...g, width, x: rows[rows.length - 1], row: rows.length - 1 }
        rows[rows.length - 1] += width
        return glyph
      })
      layout = { glyphs, rows, size: baseSize * k }
      if (s.layouts.size > 48) s.layouts.clear()
      s.layouts.set(key, layout)
      return layout
    }
    ctx.textBaseline = 'alphabetic'
    for (let rel = -3; rel <= 3; rel++) {
      const i = index + rel
      if (i < 0 || i >= L.lines.length) continue
      const slot = windowSlot(rel, sinceSwitch, moving)
      const layout = layoutOf(i)
      if (!slot || !layout || slot.alpha <= 0.01) continue
      const random = seededRandom(L.seed + i * 3.1)
      const lineX = W / 2 + (random() - 0.5) * W * 0.18 * slot.xk
      const lineY = H * (0.45 + slot.y)
      const tilt = (random() - 0.5) * 0.06
      const size = layout.size * slot.scale
      const scale = slot.scale
      const reveal = rel === 0 ? glyphRevealTimes(L.wordsOf(i)) : []
      const lastReveal = reveal[reveal.length - 1]
      const rowGap = layout.size * slot.scale * 1.15
      const elapsedMs = (time - lineStart(i)) * 1000
      const pastAmount = rel < 0 ? (time - lineStart(i + 1)) / 4 : 0
      const futureAmount = rel > 0 ? Math.min(1, (lineStart(i) - time) / 8) : 0
      const drift = moving ? t.drift : 0
      ctx.save()
      ctx.translate(lineX, lineY)
      ctx.rotate(tilt)
      ctx.font = `700 ${size}px ${font}`
      let visible = 0
      for (const [g, glyph] of layout.glyphs.entries()) {
        if (/\s/.test(glyph.char)) continue
        const gi = visible++
        // 逐字时间比排版的字少时，多出来的字跟最后一个词一起点亮。
        const timing = reveal[gi] ?? lastReveal
        const reached = timing ? elapsedMs >= timing.start : false
        const lit = rel < 0 ? 1 : rel > 0 ? 0 : !moving ? (reached ? 1 : 0) : timing ? Math.min(1, Math.max(0, (elapsedMs - timing.start) / 120)) : 0
        const singing = moving && rel === 0 && timing && elapsedMs >= timing.start && elapsedMs < timing.end + 200
        const motion = rel < 0 ? glyphDrift(L.seed, i * 97 + g, 'past', pastAmount, drift)
          : rel > 0 ? glyphDrift(L.seed, i * 97 + g, 'future', futureAmount, drift)
            : { dx: 0, dy: 0, rotate: 0, fade: 1 }
        const breathe = moving ? Math.sin(clock * 1.3 + g) * 0.02 : 0
        const rowWidth = layout.rows[glyph.row] * scale
        const gx = glyph.x * scale - rowWidth / 2 + motion.dx * size
        const gy = (glyph.row - (layout.rows.length - 1) / 2) * rowGap + (glyph.lift + breathe) * size + motion.dy * size
        const light = Math.min(1, lightAt(lineX + gx, lineY + gy))
        // 当前句：点亮的字近白、受光处更亮，没唱到的是暗刻字；离开当前位后按槽位退为余光或刻字，过渡中两者混合。
        const focusBright = lit > 0 ? 0.78 + 0.22 * light : 0
        const restBright = rel < 0 ? 0.55 + 0.25 * light : 0
        const brightness = focusBright * slot.focus + restBright * (1 - slot.focus)
        const color = singing ? mixRgb(s.accent, WARM, 0.75) : mixRgb(WARM, DIM, brightness)
        const inkFactor = (0.32 + 0.68 * lit) * slot.focus + slot.ink * (1 - slot.focus)
        const alpha = slot.alpha * motion.fade * inkFactor
        if (alpha <= 0.01) continue
        // 受光强的字、正在唱的字下面垫一层柔光。
        if (slot.focus > 0.05 && (light > 0.25 || singing) && lit > 0) {
          ctx.globalCompositeOperation = 'lighter'
          ctx.globalAlpha = Math.min(0.75, (singing ? 0.6 : 0) + light * 0.45) * slot.alpha * slot.focus
          const r = size * 1.3
          ctx.drawImage(sprite(singing ? s.accent : WARM), gx + glyph.width * scale / 2 - r, gy - size * 0.35 - r, r * 2, r * 2)
          ctx.globalCompositeOperation = 'source-over'
        }
        ctx.globalAlpha = alpha
        ctx.fillStyle = rgbCss(color)
        ctx.save()
        ctx.translate(gx + glyph.width * scale / 2, gy)
        ctx.rotate(glyph.rotate + motion.rotate)
        ctx.fillText(glyph.char, -glyph.width * scale / 2, 0)
        ctx.restore()
        // 点亮瞬间的四芒闪点。
        if (t.sparkle && moving && rel === 0 && timing) {
          const env = sparkleEnvelope((elapsedMs - timing.start) / 1000)
          if (env > 0.02) {
            const cx = gx + glyph.width * scale * 0.85
            const cy = gy - size * 0.78
            const arm = size * 0.55 * env
            ctx.globalCompositeOperation = 'lighter'
            ctx.globalAlpha = env
            ctx.fillStyle = rgbCss(WARM)
            ctx.beginPath()
            ctx.moveTo(cx, cy - arm)
            ctx.lineTo(cx + arm * 0.12, cy - arm * 0.12)
            ctx.lineTo(cx + arm, cy)
            ctx.lineTo(cx + arm * 0.12, cy + arm * 0.12)
            ctx.lineTo(cx, cy + arm)
            ctx.lineTo(cx - arm * 0.12, cy + arm * 0.12)
            ctx.lineTo(cx - arm, cy)
            ctx.lineTo(cx - arm * 0.12, cy - arm * 0.12)
            ctx.closePath()
            ctx.fill()
            ctx.globalCompositeOperation = 'source-over'
          }
        }
      }
      ctx.restore()
    }
    // 前景散景：几团很淡的大光斑缓慢漂移。
    if (t.bokeh) {
      ctx.globalCompositeOperation = 'lighter'
      for (const b of L.ambient.bokeh) {
        const x = wrap01(b.x + b.vx * clock) * W
        const y = wrap01(b.y + b.vy * clock) * H
        ctx.globalAlpha = b.alpha
        const r = b.r * H
        ctx.drawImage(sprite(s.accent), x - r, y - r, r * 2, r * 2)
      }
      ctx.globalCompositeOperation = 'source-over'
    }
    ctx.globalAlpha = 1
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
  useLayoutEffect(() => { state.current.toneAt = -Infinity }, [palette])
  useEffect(() => {
    const timer = setTimeout(() => { state.current.toneAt = -Infinity; draw.current(readLyricFrame(), true) }, 900)
    return () => clearTimeout(timer)
  }, [palette])
  useLayoutEffect(() => subscribeLyricFrames(frame => draw.current(frame)), [])
  useLayoutEffect(() => { draw.current(readLyricFrame(), true) })

  return (
    <div ref={rootRef} className={styles.root} style={{ '--lyrics-font-scale': preview ? 1 : fontScale } as React.CSSProperties}>
      <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />
      <span ref={accentProbe} className={`${styles.probe} ${styles.probeAccent}`} aria-hidden="true" />
      <span ref={accent2Probe} className={`${styles.probe} ${styles.probeAccent2}`} aria-hidden="true" />
      <span className={styles.srOnly}>{currentIndex >= 0 ? lines[currentIndex]?.text : ''}</span>
      {translation && <div className={styles.translation} style={{ fontFamily: tuning.serif ? SERIF : undefined }}>{translation}</div>}
    </div>
  )
}
