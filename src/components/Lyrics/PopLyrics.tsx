/** 跃字模式：词随演唱旋入、点亮并回落，用固定的错落姿态保留整句。 */

import { memo, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useLyricsStore } from '../../stores/lyrics'
import { usePlayerStore } from '../../stores/player'
import { useSettingsStore } from '../../stores/settings'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import { lyricPlaybackPosition } from '../../lib/lyric-playback-position'
import { fitLyricTransition, lyricLineDwellSec } from '../../lib/lyric-tempo'
import { buildPopWords, type PopWord } from '../../lib/pop-lyric-timing'
import { buildPopLyricLayout } from '../../lib/pop-lyric-layout'
import { createPopLyricTimeline } from '../../lib/pop-lyric-motion'
import { hasWordTiming } from '../../lib/word-highlight-timeline'
import type { WordLyricLine } from '../../types/domain'
import styles from './PopLyrics.module.css'

const PopLine = memo(function PopLine({ text, wordLine, lineStartMs, dwellSec, animated, fontScale, subtitleText }: {
  text: string
  wordLine: WordLyricLine | undefined
  lineStartMs: number
  dwellSec: number
  animated: boolean
  fontScale: number
  subtitleText: string
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const words = useMemo(() => buildPopWords(text, wordLine, dwellSec), [text, wordLine, dwellSec])
  const layout = useMemo(() => buildPopLyricLayout(words, dwellSec, lineStartMs), [words, dwellSec, lineStartMs])
  const moving = animated && words.some(word => word.popMs > 0)

  useLayoutEffect(() => {
    const root = rootRef.current
    const line = root?.parentElement
    const stage = line?.parentElement
    if (!root || !line || !stage) return
    let disposed = false
    const fit = () => {
      if (disposed) return
      const fits = (scale: number) => {
        root.style.setProperty('--pop-fit', String(scale))
        return line.offsetHeight <= stage.clientHeight - 20 && root.scrollWidth <= stage.clientWidth
      }
      if (fits(1)) return
      // 换行与字号并非线性关系，有限次试排找出可用的最大字号，避免一次按高度比缩得过小。
      let low = 0.3
      let high = 1
      for (let pass = 0; pass < 7; pass++) {
        const middle = (low + high) / 2
        if (fits(middle)) low = middle
        else high = middle
      }
      root.style.setProperty('--pop-fit', String(low))
    }
    const observer = new ResizeObserver(fit)
    observer.observe(stage)
    void document.fonts.ready.then(fit)
    fit()
    return () => { disposed = true; observer.disconnect() }
  }, [layout, fontScale, subtitleText])

  useEffect(() => {
    const root = rootRef.current
    if (!moving || !root) return
    const pops = Array.from(root.querySelectorAll<HTMLElement>(`.${styles.pop}`))
    const glows = Array.from(root.querySelectorAll<HTMLElement>(`.${styles.glow}`))
    if (pops.length !== words.length || glows.length !== words.length) return
    const timeline = createPopLyricTimeline(pops, glows, words, lineStartMs, { element: root, reveal: layout.reveal })
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
  }, [moving, words, lineStartMs, layout.reveal])

  return (
    <div ref={rootRef} data-composition={layout.composition} className={`${styles.words}${moving ? '' : ` ${styles.static}`}`}>
      {layout.phrases.map((phrase, index) => (
        <div key={index} data-pop-phrase className={`${styles.phrase}${phrase.accent ? ` ${styles.accent}` : ''}`} style={{
          alignSelf: phrase.align, textAlign: phrase.align === 'end' ? 'right' : phrase.align === 'start' ? 'left' : 'center',
          '--phrase-scale': phrase.scale, '--phrase-angle': `${phrase.angle}deg`,
        } as React.CSSProperties}>
          {phrase.units.map((unit) => (
            <span key={unit[0]} className={styles.unit}>
              {unit.map(i => <PopGlyph key={i} word={words[i]} />)}
            </span>
          ))}
        </div>
      ))}
    </div>
  )
})

function PopGlyph({ word }: { word: PopWord }) {
  return (
    <span className={styles.word} style={word.scale > 1 ? { fontSize: `${word.scale}em` } : undefined}>
      <span className={styles.pop}>
        <span className={styles.echo} aria-hidden="true">{word.text}</span>
        <span className={styles.base}>{word.text}</span>
        <span className={styles.glow} aria-hidden="true">{word.text}</span>
      </span>
    </span>
  )
}

export function PopLyrics() {
  const trackKey = useLyricsStore((s) => s.trackKey)
  const currentIndex = useLyricsStore((s) => s.currentIndex)
  const lines = useLyricsStore((s) => s.lines)
  const wordLines = useLyricsStore((s) => s.wordLines)
  const translation = useLyricsStore((s) => s.translation)
  const showTranslation = useSettingsStore((s) => s.lyricsShowTranslation)
  const wordMotion = useSettingsStore((s) => s.performance.lyricsWordMotion)
  const fontScale = useSettingsStore((s) => s.lyricsFontScale)
  const reducedMotion = useReducedMotion()
  const animated = wordMotion && !reducedMotion

  const current = currentIndex >= 0 ? lines[currentIndex] : undefined
  const next = lines[currentIndex + 1]
  const dwellSec = lyricLineDwellSec(lines, currentIndex)
  const switchSec = reducedMotion ? 0 : fitLyricTransition(0.45, dwellSec)
  const transText = showTranslation && currentIndex >= 0 ? translation[currentIndex]?.text?.trim() : ''
  const timed = wordLines[currentIndex]?.words && hasWordTiming(wordLines[currentIndex].words)

  return (
    <div className={styles.root} data-pop-lyrics data-timed={!!timed} style={{ '--lyrics-font-scale': fontScale } as React.CSSProperties}>
      <div className={styles.stage}>
        <AnimatePresence mode="popLayout" initial={false}>
          {current?.text.trim() && (
            <motion.div
              key={`${trackKey}-${current.time}-${currentIndex}`}
              className={styles.line}
              initial={reducedMotion ? false : { opacity: 0, scale: 0.96, rotate: currentIndex % 2 ? -2 : 2 }}
              animate={{ opacity: 1, y: 0, scale: 1, rotate: 0 }}
              // 新句开头的字是紧接着就要弹出的：旧句先在 0.14s 内淡到看不清，位移与虚化再慢慢走完，
              // 两句不会同时可读地叠在同一行；不用 mode="wait"，否则新句首字会晚弹出、和演唱脱节。
              exit={{
                opacity: 0, y: reducedMotion ? 0 : -28, x: reducedMotion ? 0 : currentIndex % 2 ? 42 : -42,
                rotate: reducedMotion ? 0 : currentIndex % 2 ? 3 : -3, scale: reducedMotion ? 1 : 1.07, filter: reducedMotion ? 'none' : 'blur(8px)',
                transition: {
                  default: { duration: switchSec * 0.7, ease: [0.4, 0, 1, 1] },
                  opacity: { duration: Math.min(0.14, switchSec), ease: 'easeOut' }
                }
              }}
              transition={{ duration: switchSec, ease: [0.22, 1, 0.36, 1] }}
            >
              <PopLine
                text={current.text}
                wordLine={wordLines[currentIndex]}
                lineStartMs={current.time * 1000}
                dwellSec={dwellSec}
                animated={animated}
                fontScale={fontScale}
                subtitleText={transText || ''}
              />
              {transText && <div className={styles.translation}>{transText}</div>}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <motion.div
        key={`next-${trackKey}-${currentIndex}`}
        className={styles.next}
        initial={reducedMotion ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: next?.text.trim() ? 1 : 0, y: 0 }}
        transition={{ duration: switchSec, ease: [0.22, 1, 0.36, 1] }}
        aria-hidden="true"
      >
        <span>{next?.text}</span>
      </motion.div>
    </div>
  )
}
