/** 跃字模式：一句歌词排成居中的连续字列，唱到的字放大跃起并换上强调色，是画面唯一的形态重心。 */

import { memo, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { indexForPosition, useLyricsStore } from '../../stores/lyrics'
import { usePlayerStore } from '../../stores/player'
import { useSettingsStore } from '../../stores/settings'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import { lyricPlaybackPosition } from '../../lib/lyric-playback-position'
import { fitLyricTransition, lyricLineDwellSec } from '../../lib/lyric-tempo'
import { buildPopWords, type PopWord } from '../../lib/pop-lyric-timing'
import { estimatePopRows, planPopRows, type PopRowPlan, type PopUnit } from '../../lib/pop-lyric-layout'
import { createPopLyricTimeline, popPeakScale } from '../../lib/pop-lyric-motion'
import { hasWordTiming } from '../../lib/word-highlight-timeline'
import { readLyricFrame, subscribeLyricFrames } from '../../lib/lyric-frame-clock'
import { useLyricStyleTuning } from '../../stores/lyric-styles'
import type { LyricLine, WordLyricLine } from '../../types/domain'
import styles from './PopLyrics.module.css'

/** 语义停顿处的词组间距（em），与 CSS 的 .pause 保持一致 */
const PAUSE_GAP_EM = 0.45
/** 当前字跃起会放大：可用宽度留出余量，行首行尾的字跃起时不贴边 */
const WIDTH_MARGIN = 0.92
/** 汉字字面约占字身的比例（两侧是字面留白） */
const CJK_INK = 0.9

/**
 * 每个字跃起时可用的峰值放大量，按真实宽度与当前字号算。
 * 两个字字面之间的空隙 = 前字右侧（汉字字面留白，或英文词尾空格）+ 字距 + 词组停顿间距 + 后字左侧字面留白；
 * 一个字每侧只用与邻字空隙的一半，行首行尾一侧不受限，所以相邻两字同时放大也不会压叠。
 */
function measurePeaks(pops: HTMLElement[], words: PopWord[], intensity: number): number[] {
  const host = pops[0]?.closest<HTMLElement>(`.${styles.words}`)
  if (!host) return words.map(() => popPeakScale(1, Infinity, intensity))
  const style = getComputedStyle(host)
  const fontPx = parseFloat(style.fontSize) || 16
  const tracking = (parseFloat(style.letterSpacing) || 0) / fontPx
  const wordGap = (parseFloat(style.wordSpacing) || 0) / fontPx
  const pauseGap = PAUSE_GAP_EM
  const shape = pops.map((pop, i) => {
    const text = words[i].text
    const width = pop.offsetWidth / fontPx
    const latin = /[\p{Script=Latin}\p{Number}]/u.test(text)
    const trailing = latin && /\s$/u.test(text) ? 0.26 + wordGap : 0
    const ink = latin ? Math.max(0.3, width - trailing - tracking) : Math.max(0.3, (width - tracking) * CJK_INK)
    const bearing = latin ? 0 : (width - tracking - ink) / 2
    const unit = pop.parentElement
    const pause = unit?.classList.contains(styles.pause) && unit.lastElementChild === pop ? pauseGap : 0
    return { ink, bearing, right: bearing + trailing + tracking + pause, row: unit?.parentElement }
  })
  const gap = (i: number) => (shape[i + 1] && shape[i + 1].row === shape[i].row ? shape[i].right + shape[i + 1].bearing : Infinity)
  return shape.map((item, i) => popPeakScale(item.ink, Math.min(i > 0 ? gap(i - 1) : Infinity, gap(i)) / 2, intensity))
}

const PopLine = memo(function PopLine({ text, wordLine, lineStartMs, dwellSec, animated, fontScale, intensity }: {
  text: string
  wordLine: WordLyricLine | undefined
  lineStartMs: number
  dwellSec: number
  animated: boolean
  fontScale: number
  intensity: number
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const words = useMemo(() => buildPopWords(text, wordLine, dwellSec), [text, wordLine, dwellSec])
  const estimate = useMemo(() => estimatePopRows(words), [words])
  const units = estimate.units
  // 分行结果连同它所依据的单元一起保存：同一句从逐行升级为逐字时序（key 不变）时，旧分行不能套到新单元上。
  const [measured, setMeasured] = useState<PopRowPlan & { units: PopUnit[] }>(estimate)
  const plan = measured.units === units ? measured : estimate
  const moving = animated && words.some(word => word.popMs > 0)

  // 按真实字体与可用宽度给出最终分行：先在原字号下量每个词组的宽，再求分行与是否缩字号。
  // 只看主句与舞台，译文开关不参与，主句不会因此缩放或跳位。
  useLayoutEffect(() => {
    const root = rootRef.current
    const stage = root?.closest<HTMLElement>(`.${styles.stage}`)
    if (!root || !stage) return
    let disposed = false
    const measure = () => {
      if (disposed) return
      root.style.setProperty('--pop-fit', '1')
      const nodes = Array.from(root.querySelectorAll<HTMLElement>('[data-pop-unit]'))
      if (nodes.length !== units.length) return
      const fontPx = parseFloat(getComputedStyle(root).fontSize) || 16
      const widths = nodes.map(node => node.offsetWidth)
      const next = planPopRows(units, widths, PAUSE_GAP_EM * fontPx, stage.clientWidth * WIDTH_MARGIN)
      // 行数 × 行高也不能超出舞台高度。
      const lineHeight = fontPx * 1.36
      const fit = Math.min(next.fit, stage.clientHeight / Math.max(1, next.rows.length * lineHeight))
      root.style.setProperty('--pop-fit', String(Math.min(1, fit)))
      setMeasured(prev => (prev.units === units && JSON.stringify(prev.rows) === JSON.stringify(next.rows) && prev.fit === fit ? prev : { units, rows: next.rows, fit }))
    }
    const observer = new ResizeObserver(measure)
    observer.observe(stage)
    void document.fonts.ready.then(measure)
    measure()
    return () => { disposed = true; observer.disconnect() }
  }, [units, fontScale])

  // 绘制前接管：重新分行或拖进句中时，新节点第一帧就是按当前时间的状态，不会先闪一帧全字影。
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!moving || !root) return
    const pick = (name: string) => Array.from(root.querySelectorAll<HTMLElement>(`.${name}`))
    const pops = pick(styles.pop)
    const inks = pick(styles.ink)
    const accents = pick(styles.hot)
    if (pops.length !== words.length || inks.length !== words.length || accents.length !== words.length) return
    // 各行是连续的词组区间，DOM 顺序即词序；分行或字号变化会重建时间轴，所以 plan 也在依赖里。
    const timeline = createPopLyricTimeline(pops, inks, accents, words, { intensity, peaks: measurePeaks(pops, words, intensity) })
    let raf = 0
    const sync = () => timeline.seek((lyricPlaybackPosition(usePlayerStore.getState()) + useLyricsStore.getState().offsetSec) * 1000 - lineStartMs)
    const loop = () => {
      sync()
      raf = requestAnimationFrame(loop)
    }
    const refresh = () => {
      cancelAnimationFrame(raf)
      raf = 0
      if (document.hidden) return
      sync()
      if (usePlayerStore.getState().status === 'playing') raf = requestAnimationFrame(loop)
    }
    const stopPlayer = usePlayerStore.subscribe((state, previous) => {
      if (state.status !== previous.status) refresh()
      else if (!raf && state.position !== previous.position && !document.hidden) sync()
    })
    const stopOffset = useLyricsStore.subscribe((state, previous) => {
      if (state.offsetSec !== previous.offsetSec && !document.hidden) sync()
    })
    document.addEventListener('visibilitychange', refresh)
    refresh()
    return () => {
      cancelAnimationFrame(raf)
      stopPlayer()
      stopOffset()
      document.removeEventListener('visibilitychange', refresh)
      timeline.dispose()
    }
  }, [moving, words, lineStartMs, intensity, plan])

  return (
    <div ref={rootRef} className={`${styles.words}${moving ? '' : ` ${styles.static}`}`}>
      {plan.rows.map((row, rowIndex) => (
        <div key={rowIndex} className={styles.row}>
          {row.map((unitIndex, i) => {
            const unit = units[unitIndex]
            return (
              <span key={unitIndex} data-pop-unit className={`${styles.unit}${unit.pause && i < row.length - 1 ? ` ${styles.pause}` : ''}`}>
                {unit.words.map(index => <PopGlyph key={index} word={words[index]} />)}
              </span>
            )
          })}
        </div>
      ))}
    </div>
  )
})

/** 一个字：字影层占位并决定字宽（显隐不重排），字墨与强调色两层叠在上面 */
function PopGlyph({ word }: { word: PopWord }) {
  return (
    <span className={styles.pop}>
      <span className={styles.ghost}>{word.text}</span>
      <span className={styles.ink} aria-hidden="true">{word.text}</span>
      <span className={styles.hot} aria-hidden="true">{word.text}</span>
    </span>
  )
}

/** 新句最多提前这么久登场，淡入在首字开唱前走完 */
const LINE_LEAD_SEC = 0.2

/**
 * 换句时机按帧时钟的精确媒体时间判断。store 的当前句由播放宿主按进度事件推进（约每 250ms 一次），
 * 新句会晚到最多约 0.27 秒，句首第一个字的跃起就被吞掉了。
 * 新句在上一句最后一个字唱完之后、最多提前 LINE_LEAD_SEC 登场，不截断上一句。
 */
export function popSwitchTimes(lines: readonly LyricLine[], wordLines: readonly (WordLyricLine | undefined)[]): LyricLine[] {
  return lines.map((line, i) => {
    if (i === 0) return line
    const prev = lines[i - 1]
    const words = wordLines[i - 1]?.words
    // 没有可信的逐字时序就不提前，免得在上一句尾字还在唱时换句。
    if (!words?.length || !hasWordTiming(words)) return line
    const last = words[words.length - 1]
    const prevEnd = prev.time + (last.startMs + (last.durationMs ?? 0)) / 1000
    if (!Number.isFinite(prevEnd)) return line
    return { ...line, time: line.time - Math.min(LINE_LEAD_SEC, Math.max(0, line.time - prevEnd)) }
  })
}

function usePreciseLineIndex(lines: LyricLine[], wordLines: (WordLyricLine | undefined)[], fallback: number): number {
  const [index, setIndex] = useState<number | null>(null)
  const switches = useMemo(() => popSwitchTimes(lines, wordLines), [lines, wordLines])
  useLayoutEffect(() => {
    if (!switches.length) { setIndex(null); return }
    const apply = (time: number) => {
      const next = indexForPosition(switches, time)
      setIndex(prev => (prev === next ? prev : next))
    }
    apply(readLyricFrame().time)
    return subscribeLyricFrames(frame => apply(frame.time))
  }, [switches])
  return index ?? fallback
}

/** 两次换句间隔短于这个值（拖动进度、极快连句）时旧句直接撤下，不播淡出，几句不会叠在一起 */
const RAPID_SWITCH_MS = 300

const lineVariants = {
  exit: ({ rapid, seconds, still }: { rapid: boolean; seconds: number; still: boolean }) => (rapid || still
    ? { opacity: 0, transition: { duration: 0 } }
    : { opacity: 0, y: -8, transition: { duration: Math.min(0.14, seconds), ease: 'easeOut' as const } }),
}

/** preview：样式选择器卡片里的缩略预览，按卡片尺寸排版，不显示下一句与译文。 */
export function PopLyrics({ preview = false }: { preview?: boolean } = {}) {
  const tuning = useLyricStyleTuning('pop')
  const trackKey = useLyricsStore((s) => s.trackKey)
  const storeIndex = useLyricsStore((s) => s.currentIndex)
  const lines = useLyricsStore((s) => s.lines)
  const wordLines = useLyricsStore((s) => s.wordLines)
  const currentIndex = usePreciseLineIndex(lines, wordLines, storeIndex)
  const translation = useLyricsStore((s) => s.translation)
  const showTranslation = useSettingsStore((s) => s.lyricsShowTranslation)
  const wordMotion = useSettingsStore((s) => s.performance.lyricsWordMotion)
  const playing = usePlayerStore((s) => s.status === 'playing')
  const fontScale = useSettingsStore((s) => s.lyricsFontScale)
  const reducedMotion = useReducedMotion()
  const animated = wordMotion && !reducedMotion

  const current = currentIndex >= 0 ? lines[currentIndex] : undefined
  const next = lines[currentIndex + 1]
  const dwellSec = lyricLineDwellSec(lines, currentIndex)
  const switchSec = reducedMotion ? 0 : fitLyricTransition(0.32, dwellSec)
  const transText = !preview && showTranslation && currentIndex >= 0 ? translation[currentIndex]?.text?.trim() : ''
  const lineKey = `${trackKey}-${current?.time}-${currentIndex}`
  const switchedAt = useRef({ key: lineKey, index: currentIndex, at: 0, rapid: false })
  if (switchedAt.current.key !== lineKey) {
    // 不是顺序进入下一句（倒拖、跨句跳转），或紧接着上一次换句：旧句直接撤下。
    const now = performance.now()
    const jumped = currentIndex !== switchedAt.current.index + 1
    switchedAt.current = { key: lineKey, index: currentIndex, at: now, rapid: jumped || now - switchedAt.current.at < RAPID_SWITCH_MS }
  }
  const exitCustom = { rapid: switchedAt.current.rapid, seconds: switchSec, still: reducedMotion }

  return (
    <div className={`${styles.root}${preview ? ` ${styles.preview}` : ''}`} data-pop-lyrics={preview ? undefined : ''} data-playing={playing && !preview ? '' : undefined} style={{ '--lyrics-font-scale': preview ? 1 : fontScale } as React.CSSProperties}>
      <div className={styles.stage}>
        <AnimatePresence mode="popLayout" initial={false} custom={exitCustom}>
          {current?.text.trim() && (
            <motion.div
              key={lineKey}
              className={styles.line}
              // 换句只有一种动作：新句轻轻升起；旧句 0.14 秒内淡出并略上移，两句不会同时可读地叠在一起。
              // 不用 mode="wait"，否则新句首字会晚于演唱。
              variants={lineVariants}
              custom={exitCustom}
              // 新句从半透明起步、0.2 秒内到位：首字往往紧接着开唱，不能等整句慢慢淡入。
              initial={reducedMotion ? false : { opacity: 0.35, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit="exit"
              transition={{ duration: Math.min(0.2, switchSec), ease: [0.22, 1, 0.36, 1] }}
            >
              <PopLine
                text={current.text}
                wordLine={wordLines[currentIndex]}
                lineStartMs={current.time * 1000}
                dwellSec={dwellSec}
                animated={animated}
                fontScale={fontScale}
                intensity={Number(tuning.intensity)}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      {/* 辅助区：固定位置与高度，译文在上、下一句在下；开关译文不影响主句。 */}
      {!preview && (
        <div className={styles.aux} aria-hidden={transText ? undefined : 'true'}>
          {/* 译文槽固定两行高，新旧译文叠在同一格里交替，不会把彼此和下一句挤开 */}
          <div className={styles.translationSlot}>
          <AnimatePresence initial={false}>
            {transText && (
              <motion.div
                key={`tr-${lineKey}`}
                className={styles.translation}
                initial={reducedMotion ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, transition: { duration: Math.min(0.14, switchSec) } }}
                transition={{ duration: switchSec }}
              >
                {transText}
              </motion.div>
            )}
          </AnimatePresence>
          </div>
          <motion.div
            key={`next-${lineKey}`}
            className={styles.next}
            initial={reducedMotion ? false : { opacity: 0 }}
            animate={{ opacity: next?.text.trim() ? 1 : 0 }}
            transition={{ duration: switchSec }}
            aria-hidden="true"
          >
            {next?.text}
          </motion.div>
        </div>
      )}
    </div>
  )
}
