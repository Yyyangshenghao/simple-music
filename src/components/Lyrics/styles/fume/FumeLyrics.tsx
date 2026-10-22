import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLyricsStore } from '../../../../stores/lyrics'
import { useSettingsStore } from '../../../../stores/settings'
import { useLyricStyleTuning } from '../../../../stores/lyric-styles'
import { useReducedMotion } from '../../../../hooks/useReducedMotion'
import { readLyricFrame, subscribeLyricFrames, type LyricFrame } from '../../../../lib/lyric-frame-clock'
import { lyricLineDwellSec } from '../../../../lib/lyric-tempo'
import { buildStyleWords, seedFromText } from '../../../../lib/lyric-style-layouts'
import {
  buildFumeCollage, cameraSettled, fumeCameraTarget, nearestTextLine, printedGlyphs, stepFumeCamera,
  type CollageLine, type FumeCamera, type FumeCollage, type Rect,
} from '../../../../lib/fume-collage'
import { usePreciseLineIndex } from '../../../../hooks/usePreciseLineIndex'
import styles from './FumeLyrics.module.css'

/**
 * 拼版（样式 ID 沿用 fume）：整首歌词拼成一张杂志版面，段落各有字号、横排或竖排与一种封面取色。
 * 镜头在版面上平移到正在唱的句子，当前句随演唱逐字着墨；唱过的句子褪到保留亮度，没唱到的以浅色铺开。
 * DOM 排版：文字只排一次，镜头只改整张版面的 transform（交给合成器），逐帧只改当前句几个字的透明度。
 */
const SERIF = "'Songti SC', 'STSong', 'Noto Serif CJK SC', 'Source Han Serif SC', 'Noto Serif SC', serif"
const clamp01 = (value: number) => Math.min(1, Math.max(0, value))
/** 版面与下方译文之间的间隙 */
const TRANSLATION_GAP = 18
/** 当前句还没唱到的字的透明度 */
const UNPRINTED = 0.42

interface FumeTuning {
  zoom: number
  float: number
  hold: number
  vertical: boolean
  color: boolean
  serif: boolean
}

/** 一句的字：非空白字各占一个 span（逐字着墨），空白原样保留。 */
function LineGlyphs({ line }: { line: CollageLine }) {
  let index = 0
  return line.rows.map((row, r) => (
    <span key={r} className={styles.row}>
      {Array.from(row).map((char, c) => /\s/.test(char) ? char : <span key={c} className={styles.glyph} data-glyph={index++}>{char}</span>)}
    </span>
  ))
}

export function FumeLyrics({ preview = false }: { preview?: boolean }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const worldRef = useRef<HTMLDivElement>(null)
  const translationRef = useRef<HTMLDivElement>(null)
  const trackKey = useLyricsStore(state => state.trackKey)
  const lines = useLyricsStore(state => state.lines)
  const wordLines = useLyricsStore(state => state.wordLines)
  const translations = useLyricsStore(state => state.translation)
  const storeIndex = useLyricsStore(state => state.currentIndex)
  // 换句按帧时钟的精确时间（与跃字、云阶同一套）：镜头提前起步，到首字开唱时已移到新句。
  const currentIndex = usePreciseLineIndex(lines, wordLines, storeIndex)
  const showTranslation = useSettingsStore(state => state.lyricsShowTranslation)
  const fontScale = useSettingsStore(state => state.lyricsFontScale)
  const wordMotion = useSettingsStore(state => state.performance.lyricsWordMotion)
  const reducedMotion = useReducedMotion()
  const animated = wordMotion && !reducedMotion
  const raw = useLyricStyleTuning('fume')
  const tuning = useMemo<FumeTuning>(() => ({
    zoom: Number(raw.zoom), float: Number(raw.float), hold: Number(raw.hold),
    vertical: raw.vertical === true, color: raw.color === true, serif: raw.serif === true,
  }), [raw])
  const [fontsReady, setFontsReady] = useState(0)
  const [stage, setStage] = useState({ width: 0, height: 0 })
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
  const collage = useMemo<FumeCollage>(() => {
    const ctx = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d')
    const cache = new Map<string, number>()
    // 没有画布（服务端渲染、测试）时按每字一个字号估算；排版只需要大致宽度，实际字形由浏览器排。
    const measure = (text: string, size: number) => {
      const key = `${size}|${text}`
      let width = cache.get(key)
      if (width === undefined) {
        if (ctx) {
          ctx.font = `700 ${size}px ${family}`
          width = ctx.measureText(text).width
        } else {
          width = Array.from(text).length * size
        }
        cache.set(key, width)
      }
      return width
    }
    return buildFumeCollage(lines, measure, seedFromText(trackKey ?? ''), { vertical: tuning.vertical })
  // fontsReady 只用来在字体加载完成后触发重排。
  }, [lines, trackKey, family, tuning.vertical, fontsReady])

  // 基准字号随舞台高度走，再乘字号设置与“版面大小”。选择器缩略图整体缩得很小，字放大些才看得出版面。
  const unit = Math.min(Math.max(stage.height * 0.085, 22), 84) * (preview ? 1.8 : fontScale) * tuning.zoom

  // 当前句的逐词时序：着墨进度按演唱时间推进。
  const words = useMemo(() => {
    const line = currentIndex >= 0 ? lines[currentIndex] : undefined
    return line?.text.trim() ? buildStyleWords(line.text, wordLines[currentIndex], lyricLineDwellSec(lines, currentIndex)) : []
  }, [lines, wordLines, currentIndex])

  // 逐帧状态放在 ref 里，帧回调读取最新值，不随重渲染重新订阅。
  const state = useRef({
    camera: null as FumeCamera | null, lastNow: 0, lastIndex: -2, settleRaf: 0, transform: '',
    rects: [] as (Rect | undefined)[], glyphs: [] as HTMLElement[], inks: [] as number[],
  })
  const latest = useRef({ collage, words, tuning, animated, currentIndex, lines, stage })
  latest.current = { collage, words, tuning, animated, currentIndex, lines, stage }

  const draw = useRef<(frame: LyricFrame) => void>(() => {})
  draw.current = (frame: LyricFrame) => {
    const world = worldRef.current
    const s = state.current
    const { collage: page, words: lineWords, tuning: t, animated: moving, currentIndex: index, lines: allLines, stage: size } = latest.current
    if (!world || !size.width || !size.height) return
    const focus = nearestTextLine(page, Math.max(0, index))
    const rect = s.rects[focus]
    if (!rect) return

    // 镜头：平滑追向当前句；跳句（拖动）、首帧或静态模式直接到位。
    const target = fumeCameraTarget(rect, size)
    const dt = s.lastNow ? Math.min(0.1, (frame.now - s.lastNow) / 1000) : 0
    s.lastNow = frame.now
    const jumped = s.lastIndex !== -2 && Math.abs(index - s.lastIndex) > 2
    s.lastIndex = index
    s.camera = !s.camera || !moving || jumped ? target : stepFumeCamera(s.camera, target, dt)
    const camera = s.camera
    // 播放时镜头轻微漂浮，像手持跟拍。
    const drift = moving && frame.running ? t.float : 0
    const x = size.width / 2 - camera.x * camera.scale + Math.sin(frame.now / 2300) * 10 * drift
    const y = size.height * 0.46 - camera.y * camera.scale + Math.cos(frame.now / 3100) * 7 * drift
    const transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) scale(${camera.scale.toFixed(4)})`
    if (transform !== s.transform) {
      s.transform = transform
      world.style.transform = transform
    }

    // 当前句逐字着墨：只改变化了的字。
    const elapsed = index >= 0 ? frame.time * 1000 - (allLines[index]?.time ?? 0) * 1000 : 0
    const printed = printedGlyphs(lineWords, elapsed)
    s.glyphs.forEach((glyph, i) => {
      const ink = moving ? UNPRINTED + (1 - UNPRINTED) * clamp01(printed - i) : 1
      if (Math.abs(ink - (s.inks[i] ?? -1)) < 0.01) return
      s.inks[i] = ink
      glyph.style.opacity = ink.toFixed(3)
    })

    // 暂停时帧时钟不再推送：自己补几帧让镜头停稳。
    if (!frame.running && moving && !cameraSettled(camera, target) && !s.settleRaf) {
      s.settleRaf = requestAnimationFrame(now => {
        s.settleRaf = 0
        draw.current({ ...readLyricFrame(), now })
      })
    }
  }

  // 换歌（版面重排）时镜头直接到位，不从上一首的坐标滑过来。
  useLayoutEffect(() => { state.current.camera = null; state.current.lastIndex = -2 }, [collage])
  // 量出每句在版面上的位置（布局坐标，不受镜头 transform 影响），镜头按它对准。
  useLayoutEffect(() => {
    const world = worldRef.current
    if (!world) return
    const rects: (Rect | undefined)[] = []
    world.querySelectorAll<HTMLElement>('[data-line]').forEach(line => {
      const block = line.offsetParent as HTMLElement | null
      rects[Number(line.dataset.line)] = {
        x: (block?.offsetLeft ?? 0) + line.offsetLeft, y: (block?.offsetTop ?? 0) + line.offsetTop,
        width: line.offsetWidth, height: line.offsetHeight,
      }
    })
    state.current.rects = rects
    // 镜头位置以像素计：基准字号变了（缩放窗口、改字号）直接到位，不从旧坐标滑过来。
    state.current.camera = null
  }, [collage, unit, family])
  // 换句后重新收集当前句的字。
  useLayoutEffect(() => {
    state.current.glyphs = Array.from(worldRef.current?.querySelectorAll<HTMLElement>(`[data-line="${currentIndex}"] [data-glyph]`) ?? [])
    state.current.inks = []
  }, [currentIndex, collage, unit])
  // 舞台尺寸变化时更新。显示译文时版面只铺到译文上方（留一点间隙），文字不会从译文底下穿过。
  // 译文位固定高度（两行）且整首歌不变：句与句之间译文有无、行数不同，版面高度和镜头中心都不跟着跳。
  const translation = !preview && showTranslation && currentIndex >= 0 ? translations[currentIndex]?.text?.trim() : ''
  const translationSlot = !preview && showTranslation && translations.some(item => item.text?.trim())
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    const measureSize = () => {
      const note = translationRef.current
      const reserve = note ? Math.max(0, root.clientHeight - note.offsetTop + TRANSLATION_GAP) : 0
      root.style.setProperty('--fume-reserve', `${reserve}px`)
      const next = { width: root.clientWidth, height: Math.max(0, root.clientHeight - reserve) }
      setStage(previous => previous.width === next.width && previous.height === next.height ? previous : next)
    }
    const observer = new ResizeObserver(measureSize)
    observer.observe(root)
    if (translationRef.current) observer.observe(translationRef.current)
    measureSize()
    return () => observer.disconnect()
  }, [translationSlot])
  useLayoutEffect(() => subscribeLyricFrames(frame => draw.current(frame)), [])
  useLayoutEffect(() => { draw.current(readLyricFrame()) })
  useEffect(() => () => cancelAnimationFrame(state.current.settleRaf), [])

  const lineState = (lineIndex: number) => lineIndex === currentIndex ? styles.current : lineIndex < currentIndex ? styles.past : styles.future
  return (
    <div ref={rootRef} className={`${styles.root}${tuning.color ? '' : ` ${styles.mono}`}`}
      style={{ fontFamily: tuning.serif ? SERIF : undefined, '--lyrics-font-scale': preview ? 1 : fontScale, '--fume-hold': 0.14 + 0.5 * tuning.hold } as React.CSSProperties}>
      <div className={styles.stage} aria-hidden="true">
        <div ref={worldRef} className={styles.world} style={{ '--b': `${unit}px` } as React.CSSProperties}>
          {collage.blocks.map((block, b) => (
            <div key={b} className={`${styles.block} ${block.vertical ? styles.vertical : styles.horizontal}`} data-tone={block.tone}
              style={{ left: `calc(${block.x} * var(--b))`, top: `calc(${block.y} * var(--b))`, fontSize: `calc(${block.size} * var(--b))` }}>
              {block.lines.map(line => (
                <span key={line.lineIndex} className={`${styles.line} ${lineState(line.lineIndex)}`} data-line={line.lineIndex}>
                  {line.lineIndex === currentIndex
                    ? <LineGlyphs line={line} />
                    : line.rows.map((row, r) => <span key={r} className={styles.row}>{row}</span>)}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
      {/* 屏幕阅读器读当前句；版面只是视觉呈现。 */}
      <span className={styles.srOnly} aria-live="off">{currentIndex >= 0 ? lines[currentIndex]?.text : ''}</span>
      {translationSlot && <div ref={translationRef} className={styles.translation}>{translation}</div>}
    </div>
  )
}
