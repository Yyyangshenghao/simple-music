import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLyricsStore } from '../../../../stores/lyrics'
import { useSettingsStore } from '../../../../stores/settings'
import { useAmbientStore } from '../../../../stores/ambient'
import { useLyricStyleTuning } from '../../../../stores/lyric-styles'
import { useLightTheme } from '../../../../hooks/useLightTheme'
import { useReducedMotion } from '../../../../hooks/useReducedMotion'
import { readLyricFrame, subscribeLyricFrames, type LyricFrame } from '../../../../lib/lyric-frame-clock'
import { lyricLineDwellSec } from '../../../../lib/lyric-tempo'
import { buildStyleWords, seededRandom, seedFromText } from '../../../../lib/lyric-style-layouts'
import { contrastOn, mixRgb, parseCssColor, rgbCss, type Rgb } from '../../../../lib/canvas-color'
import {
  compileTemperaProgram, handoffSec, layoutShotText, releaseSpread, temperaComposition, visibleShots, wordMotion,
  type TemperaGlyphRun, type TemperaShape, type TemperaShot,
} from '../../../../lib/tempera-program'
import styles from './TemperaLyrics.module.css'

/**
 * 凝彩：平涂色块 + 网点线条的歌词 PV（参考 Folia 同名样式重写）。
 * 每句按词组切成几镜，镜头沿统一流向接力推进；色块从画外长出，字一个个“拼”上去，
 * 压在色块上的部分自动换成对比色，一个词会被明暗分界切成两色。全部由媒体时间决定，暂停与拖动直接定位。
 */
interface TemperaTuning {
  settle: number
  wholeLine: boolean
  echo: boolean
  decor: boolean
  mono: boolean
  camera: number
}

interface Tones {
  ink: Rgb
  paper: Rgb
  tone: Record<1 | 2 | 3, Rgb>
}

function polyPath(points: [number, number][], path = new Path2D()): Path2D {
  points.forEach(([x, y], i) => i ? path.lineTo(x, y) : path.moveTo(x, y))
  path.closePath()
  return path
}

function drawHatch(ctx: CanvasRenderingContext2D, shape: Extract<TemperaShape, { type: 'hatch' }>, ink: Rgb): void {
  if (shape.gap < 2) return
  ctx.save()
  ctx.clip(polyPath(shape.points))
  const xs = shape.points.map(p => p[0])
  const ys = shape.points.map(p => p[1])
  const x0 = Math.min(...xs)
  const x1 = Math.max(...xs)
  const y0 = Math.min(...ys)
  const y1 = Math.max(...ys)
  const span = (x1 - x0) + (y1 - y0)
  const dx = Math.cos(shape.angle)
  const dy = Math.sin(shape.angle)
  ctx.strokeStyle = rgbCss(ink, 0.38)
  ctx.lineWidth = Math.max(1, shape.gap * 0.22)
  ctx.beginPath()
  for (let d = -span; d <= span; d += shape.gap) {
    const cx = (x0 + x1) / 2 - dy * d
    const cy = (y0 + y1) / 2 + dx * d
    ctx.moveTo(cx - dx * span, cy - dy * span)
    ctx.lineTo(cx + dx * span, cy + dy * span)
  }
  ctx.stroke()
  ctx.restore()
}

export function TemperaLyrics({ preview = false }: { preview?: boolean }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const inkProbe = useRef<HTMLSpanElement>(null)
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
  const palette = useAmbientStore(state => state.palette)
  const light = useLightTheme()
  const reducedMotion = useReducedMotion()
  const animated = wordMotionEnabled && !reducedMotion
  const raw = useLyricStyleTuning('tempera')
  const tuning = useMemo<TemperaTuning>(() => ({
    settle: Number(raw.settle), wholeLine: raw.wholeLine === true, echo: raw.echo === true,
    decor: raw.decor === true, mono: raw.mono === true, camera: Number(raw.camera),
  }), [raw])
  const [family, setFamily] = useState('system-ui, sans-serif')
  const appFont = useSettingsStore(state => state.fontFamily)
  const lyricFont = useSettingsStore(state => state.lyricsFontFamily)
  // 跟随设置里的界面与歌词字体；字体变量由别处在同一轮提交里更新，下一帧再读。
  useEffect(() => {
    const read = () => {
      const host = rootRef.current?.parentElement
      if (host) setFamily(getComputedStyle(host).fontFamily || 'system-ui, sans-serif')
    }
    read()
    const frame = requestAnimationFrame(read)
    return () => cancelAnimationFrame(frame)
  }, [appFont, lyricFont])

  // 整首歌的镜头表：歌词、逐字时间或整句开关变化时重新编译。
  const program = useMemo<TemperaShot[]>(() => {
    const words = lines.map((line, i) => line.text.trim() ? buildStyleWords(line.text, wordLines[i], lyricLineDwellSec(lines, i)) : [])
    return compileTemperaProgram(lines, words, seedFromText(trackKey ?? ''), { wholeLine: tuning.wholeLine })
  }, [lines, wordLines, trackKey, tuning.wholeLine])

  const state = useRef({
    size: { width: 0, height: 0 },
    toneAt: -Infinity,
    tones: { ink: [245, 243, 238], paper: [14, 13, 18], tone: { 1: [245, 243, 238], 2: [80, 60, 140], 3: [255, 160, 220] } } as Tones,
    layouts: new Map<string, TemperaGlyphRun[]>(),
    /** 静态模式下画面签名没变就不重画 */
    signature: '',
  })
  const translation = !preview && showTranslation && currentIndex >= 0 ? translations[currentIndex]?.text?.trim() : ''
  const latest = useRef({ program, tuning, animated, fontScale, family, light, preview, withTranslation: !!translation })
  latest.current = { program, tuning, animated, fontScale, family, light, preview, withTranslation: !!translation }
  // 换歌、改字号、改字体或排版参数时，镜头的文字排版缓存作废。
  useLayoutEffect(() => { state.current.layouts.clear() }, [program, fontScale, family])

  const draw = useRef<(frame: LyricFrame, force?: boolean) => void>(() => {})
  draw.current = (frame: LyricFrame, force = false) => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    const s = state.current
    const { program: shots, tuning: t, animated: moving, fontScale: scaleSetting, family: font, light: isLight, preview: small, withTranslation } = latest.current
    if (!canvas || !ctx || !s.size.width || !s.size.height) return
    const { width: W, height: H } = s.size
    const ratio = small ? 0.4 : Math.min(2, window.devicePixelRatio || 1)
    if (canvas.width !== Math.round(W * ratio) || canvas.height !== Math.round(H * ratio)) {
      canvas.width = Math.round(W * ratio)
      canvas.height = Math.round(H * ratio)
    }
    // 配色：墨色取主文字色，纸色按主题，色块取封面氛围色；隔一会儿重读，跟上主题与封面过渡。
    if (frame.now - s.toneAt > 400) {
      s.toneAt = frame.now
      const ink = parseCssColor(inkProbe.current ? getComputedStyle(inkProbe.current).color : '', s.tones.ink)
      const paper: Rgb = isLight ? [243, 240, 234] : [14, 13, 18]
      const accent = parseCssColor(accentProbe.current ? getComputedStyle(accentProbe.current).color : '', s.tones.tone[3])
      const accent2 = parseCssColor(accent2Probe.current ? getComputedStyle(accent2Probe.current).color : '', s.tones.tone[2])
      s.tones = t.mono
        ? { ink, paper, tone: { 1: ink, 2: mixRgb(ink, paper, 0.28), 3: mixRgb(ink, paper, 0.62) } }
        : { ink, paper, tone: { 1: ink, 2: mixRgb(accent2, paper, 0.62), 3: accent } }
    }
    const { ink, paper, tone } = s.tones
    const placements = visibleShots(shots, frame.time, moving)
    // 静态模式（减弱动态/关闭逐字动效）：画面只在换镜、唱到新词或配色尺寸变化时才变，其余帧不重画。
    if (!moving) {
      const sung = placements.map(({ shot, index }) => `${index}:${shot.words.filter(word => frame.time - shot.start >= word.startMs / 1000 - 0.1).length}`).join(',')
      const signature = `${sung}|${s.toneAt}|${W}x${H}|${ratio}`
      if (!force && signature === s.signature) return
      s.signature = signature
    } else {
      s.signature = ''
    }
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    ctx.clearRect(0, 0, W, H)
    // 纸面：半透明平涂，封面氛围色仍能从底下透出来。
    ctx.globalAlpha = 1
    ctx.fillStyle = rgbCss(paper, 0.82)
    ctx.fillRect(0, 0, W, H)

    const baseSize = Math.min(Math.max(H * 0.13, 30), 128) * (small ? 1 : scaleSetting)
    for (const { shot, index, push } of placements) {
      const local = frame.time - shot.start
      const duration = Math.max(0.1, shot.end - shot.start)
      const lyricSpan = Math.max(0.6, (shot.lineIndex >= 0 ? shot.lyricEnd : shot.end) - shot.start)
      // 色块的入场节奏按本镜唱完的时长比例分配，并从推入画面时就开始长。
      const delay = Math.min(0.5, lyricSpan * 0.06)
      const span = Math.min(2.6, Math.max(0.7, lyricSpan * 0.55))
      const grow = moving ? 1 - Math.pow(1 - Math.max(0, Math.min(1, (local + handoffSec(shot) - delay) / span)), 3) : 1
      const flowX = Math.sin(shot.flow)
      const flowY = -Math.cos(shot.flow)
      const creep = moving ? Math.min(1, Math.max(0, local / duration)) * t.camera : 0
      const shift = push * H * 1.15 + creep * H * 0.035
      ctx.save()
      ctx.translate(flowX * shift, flowY * shift)
      const zoom = 1 + creep * 0.03
      ctx.translate(W / 2, H / 2)
      ctx.scale(zoom, zoom)
      ctx.translate(-W / 2, -H / 2)

      const composition = temperaComposition(shot, W, H, grow, t.decor)
      // 文字按色块长成后的构图排位，不跟着色块的入场一起滑动。
      const fullRegion = grow < 1 ? temperaComposition(shot, W, H, 1, t.decor).region : composition.region
      // 有译文时文字区下沿收到译文条上方，避免多行歌词被底衬压住。
      const limit = H * 0.7
      const region = withTranslation && fullRegion.y + fullRegion.h / 2 > limit
        ? (() => {
          const top = Math.min(fullRegion.y - fullRegion.h / 2, limit - H * 0.2)
          return { ...fullRegion, y: (top + limit) / 2, h: limit - top }
        })()
        : fullRegion
      const random = seededRandom(shot.seed + 99)
      // 背景装饰大字：在色块之下，歌词压过它的笔画。
      if (shot.watermark) {
        ctx.save()
        ctx.globalAlpha = 0.09
        ctx.fillStyle = rgbCss(ink)
        ctx.font = `900 ${H * 0.42}px ${font}`
        ctx.textAlign = 'center'
        ctx.translate(W * (0.3 + random() * 0.4), H * (0.3 + random() * 0.4))
        ctx.rotate(shot.flow * 0.6)
        ctx.fillText(shot.watermark, 0, H * 0.14)
        ctx.restore()
      }
      // 色块：按顺序平涂，记下每块的路径与压在上面的文字色，字稍后按块重画一遍。
      const knockouts: { path: Path2D; color: Rgb; box: [number, number, number, number] }[] = []
      const boxOf = (points: [number, number][]): [number, number, number, number] => [
        Math.min(...points.map(p => p[0])), Math.min(...points.map(p => p[1])), Math.max(...points.map(p => p[0])), Math.max(...points.map(p => p[1])),
      ]
      for (const shape of composition.shapes) {
        ctx.globalAlpha = 1
        if (shape.type === 'poly') {
          const path = polyPath(shape.points)
          if (shape.hole) polyPath(shape.hole, path)
          ctx.fillStyle = rgbCss(tone[shape.tone])
          ctx.fill(path, 'evenodd')
          knockouts.push({ path, color: contrastOn(tone[shape.tone], ink, paper), box: boxOf(shape.points) })
        } else if (shape.type === 'circle') {
          const path = new Path2D()
          path.arc(shape.x, shape.y, shape.r, 0, Math.PI * 2)
          if (shape.ring) {
            ctx.strokeStyle = rgbCss(ink, 0.5)
            ctx.lineWidth = shape.ring
            ctx.stroke(path)
          } else {
            ctx.fillStyle = rgbCss(tone[shape.tone])
            ctx.fill(path)
            knockouts.push({ path, color: contrastOn(tone[shape.tone], ink, paper), box: [shape.x - shape.r, shape.y - shape.r, shape.x + shape.r, shape.y + shape.r] })
          }
        } else if (shape.type === 'hatch') {
          drawHatch(ctx, shape, ink)
        } else {
          ctx.strokeStyle = rgbCss(ink, 0.45)
          ctx.lineWidth = shape.width
          ctx.beginPath()
          ctx.moveTo(shape.x0, shape.y0)
          ctx.lineTo(shape.x1, shape.y1)
          ctx.stroke()
        }
      }
      // 共用装饰：两条满出血细线与一角的十字网点。
      if (t.decor) {
        ctx.strokeStyle = rgbCss(ink, 0.2)
        ctx.lineWidth = 1
        ctx.beginPath()
        for (let i = 0; i < 2; i++) {
          const y = H * (0.15 + random() * 0.7)
          const slope = (random() - 0.5) * H * 0.6
          ctx.moveTo(-W * 0.1, y - slope)
          ctx.lineTo(W * 1.1, y + slope)
        }
        const cornerX = random() < 0.5 ? W * 0.06 : W * 0.82
        const cornerY = random() < 0.5 ? H * 0.12 : H * 0.7
        const step = H * 0.03
        for (let gx = 0; gx < 4; gx++) for (let gy = 0; gy < 3; gy++) {
          const x = cornerX + gx * step * 1.6
          const y = cornerY + gy * step * 1.6
          ctx.moveTo(x - step * 0.3, y)
          ctx.lineTo(x + step * 0.3, y)
          ctx.moveTo(x, y - step * 0.3)
          ctx.lineTo(x, y + step * 0.3)
        }
        ctx.stroke()
      }

      if (shot.words.length) {
        const key = `${index}|${W}|${H}|${withTranslation ? 1 : 0}`
        let runs = s.layouts.get(key)
        if (!runs) {
          ctx.font = `900 ${baseSize}px ${font}`
          const measure = (text: string, size: number) => {
            ctx.font = `900 ${size}px ${font}`
            return ctx.measureText(text).width
          }
          runs = layoutShotText(shot.words, shot.hero, region, baseSize, measure)
          if (s.layouts.size > 64) s.layouts.clear()
          s.layouts.set(key, runs)
        }
        const spread = moving ? releaseSpread(local, shot.lyricEnd - shot.start, duration) : 1
        const placed = runs.map(run => {
          const word = shot.words[run.word]
          const motion = moving
            ? wordMotion(word, local, shot.lyricEnd - shot.start, shot.flow, t.settle)
            : { opacity: local >= word.startMs / 1000 - 0.1 || shot.end - shot.start < 0.8 ? 1 : 0.35, dx: 0, dy: 0, scale: 1, settled: 1 }
          const centerX = region.x + (run.x + run.width / 2) * spread
          const baseY = region.y + run.y * spread
          return { run, motion, centerX, baseY }
        })
        const paint = (color: Rgb, withEcho: boolean) => {
          const fill = rgbCss(color)
          ctx.textAlign = 'center'
          ctx.fillStyle = fill
          for (const { run, motion, centerX, baseY } of placed) {
            if (motion.opacity <= 0) continue
            ctx.font = `900 ${run.size}px ${font}`
            const drawAt = (k: number, alpha: number) => {
              ctx.globalAlpha = alpha
              const x = centerX + motion.dx * run.size * k
              const y = baseY + motion.dy * run.size * k
              if (motion.scale === 1) { ctx.fillText(run.text, x, y); return }
              ctx.save()
              ctx.translate(x, y)
              ctx.scale(motion.scale, motion.scale)
              ctx.fillText(run.text, 0, 0)
              ctx.restore()
            }
            // 运动浮影：沿入场方向拖出两层淡影，落定后消失。
            if (withEcho && motion.settled < 0.97) {
              drawAt(2.2, 0.12 * motion.opacity)
              drawAt(1.6, 0.24 * motion.opacity)
            }
            drawAt(1, motion.opacity)
          }
        }
        const baseColor = contrastOn(paper, ink, paper)
        paint(baseColor, t.echo && moving)
        // 文字范围（含入场位移的余量），用来跳过与文字不相交的色块。
        const reach = Math.max(0, ...placed.map(p => p.run.size)) * 2.4
        const textBox = [
          Math.min(...placed.map(p => p.centerX - p.run.width / 2)) - reach, Math.min(...placed.map(p => p.baseY - p.run.size)) - reach,
          Math.max(...placed.map(p => p.centerX + p.run.width / 2)) + reach, Math.max(...placed.map(p => p.baseY + p.run.size * 0.3)) + reach,
        ]
        for (const knockout of knockouts) {
          // 底上的对比色与底稿色相同、或色块碰不到文字时不必重画。
          if (knockout.color.every((value, i) => value === baseColor[i])) continue
          const [x0, y0, x1, y1] = knockout.box
          if (x1 < textBox[0] || x0 > textBox[2] || y1 < textBox[1] || y0 > textBox[3]) continue
          ctx.save()
          ctx.clip(knockout.path, 'evenodd')
          paint(knockout.color, false)
          ctx.restore()
        }
      }
      ctx.restore()
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
  useLayoutEffect(() => { state.current.toneAt = -Infinity }, [light, palette, tuning.mono])
  // 封面配色逐步过渡（约 0.8s）：暂停时没有新帧，过渡结束后补画一次。
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
      <span ref={accent2Probe} className={`${styles.probe} ${styles.probeAccent2}`} aria-hidden="true" />
      <span className={styles.srOnly}>{currentIndex >= 0 ? lines[currentIndex]?.text : ''}</span>
      {translation && <div className={styles.translation}>{translation}</div>}
    </div>
  )
}
