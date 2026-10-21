/** 跃字模式：一次只演一句大字，每个词在轮到它时从下方弹出、点亮，唱过后保留但转暗。 */

import { memo, useEffect, useMemo, useRef } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useLyricsStore } from '../../stores/lyrics'
import { usePlayerStore } from '../../stores/player'
import { useSettingsStore } from '../../stores/settings'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import { lyricPlaybackPosition } from '../../lib/lyric-playback-position'
import { fitLyricTransition, lyricLineDwellSec } from '../../lib/lyric-tempo'
import { groupLyricBreakUnits } from '../../lib/lyric-line-break'
import { buildPopWords, POP_LEAD_MS, type PopWord } from '../../lib/pop-lyric-timing'
import type { WordLyricLine } from '../../types/domain'
import styles from './PopLyrics.module.css'

/** 唱完后高亮层再保留一小段才转暗，避免字一唱完就熄灭。 */
const GLOW_HOLD_MS = 420

const PopLine = memo(function PopLine({ text, wordLine, lineStartMs, dwellSec, animated }: {
  text: string
  wordLine: WordLyricLine | undefined
  lineStartMs: number
  dwellSec: number
  animated: boolean
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const words = useMemo(() => buildPopWords(text, wordLine, dwellSec), [text, wordLine, dwellSec])
  const units = useMemo(() => groupLyricBreakUnits(words.map((word) => word.text)), [words])

  useEffect(() => {
    const root = rootRef.current
    if (!animated || !root) return
    const pops = Array.from(root.querySelectorAll<HTMLElement>(`.${styles.pop}`))
    const glows = Array.from(root.querySelectorAll<HTMLElement>(`.${styles.glow}`))
    if (pops.length !== words.length || glows.length !== words.length) return
    const entries = words.map((word, i) => {
      const popDuration = Math.max(1, word.popMs)
      const pop = pops[i].animate([
        { opacity: 0, transform: 'translateY(0.42em) scale(0.62)', filter: 'blur(8px)' },
        { opacity: 1, transform: 'translateY(-0.06em) scale(1.07)', filter: 'blur(0px)', offset: 0.62 },
        { opacity: 1, transform: 'translateY(0) scale(1)', filter: 'blur(0px)' }
      ], { duration: popDuration, fill: 'both', easing: 'cubic-bezier(0.2, 0.9, 0.3, 1)' })
      const glowDuration = Math.max(1, word.durationMs) + GLOW_HOLD_MS
      const glow = glows[i].animate([
        { opacity: 1 },
        { opacity: 1, offset: Math.max(0, Math.min(0.95, Math.max(1, word.durationMs) / glowDuration)) },
        { opacity: 0 }
      ], { duration: glowDuration, fill: 'both', easing: 'ease-out' })
      pop.pause()
      glow.pause()
      return { word, pop, popDuration, glow, glowDuration }
    })
    const seek = (elapsed: number) => {
      for (const e of entries) {
        const popAt = Math.min(e.popDuration, Math.max(0, elapsed - (e.word.startMs - POP_LEAD_MS)))
        const glowAt = Math.min(e.glowDuration, Math.max(0, elapsed - e.word.startMs))
        if (e.pop.currentTime !== popAt) e.pop.currentTime = popAt
        if (e.glow.currentTime !== glowAt) e.glow.currentTime = glowAt
      }
    }
    let raf = 0
    const loop = () => {
      if (!document.hidden) {
        const position = lyricPlaybackPosition(usePlayerStore.getState()) + useLyricsStore.getState().offsetSec
        seek(position * 1000 - lineStartMs)
      }
      raf = requestAnimationFrame(loop)
    }
    loop()
    return () => {
      cancelAnimationFrame(raf)
      for (const e of entries) {
        e.pop.cancel()
        e.glow.cancel()
      }
    }
  }, [animated, words, lineStartMs])

  return (
    <div ref={rootRef} className={`${styles.words}${animated ? '' : ` ${styles.static}`}`}>
      {units.map((unit) => (
        <span key={unit[0]} className={styles.unit}>
          {unit.map((i) => <PopGlyph key={i} word={words[i]} />)}
        </span>
      ))}
    </div>
  )
})

function PopGlyph({ word }: { word: PopWord }) {
  return (
    <span className={styles.word} style={word.scale > 1 ? { fontSize: `${word.scale}em` } : undefined}>
      <span className={styles.pop}>
        <span className={styles.base}>{word.text}</span>
        <span className={styles.glow} aria-hidden="true">{word.text}</span>
      </span>
    </span>
  )
}

export function PopLyrics() {
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

  return (
    <div className={styles.root} style={{ '--lyrics-font-scale': fontScale } as React.CSSProperties}>
      <div className={styles.stage}>
        <AnimatePresence mode="popLayout" initial={false}>
          {current?.text.trim() && (
            <motion.div
              key={`${current.time}-${currentIndex}`}
              className={styles.line}
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              // 新句开头的字是紧接着就要弹出的：旧句先在 0.14s 内淡到看不清，位移与虚化再慢慢走完，
              // 两句不会同时可读地叠在同一行；不用 mode="wait"，否则新句首字会晚弹出、和演唱脱节。
              exit={{
                opacity: 0, y: -120, scale: 0.8, filter: 'blur(8px)',
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
              />
              {transText && <div className={styles.translation}>{transText}</div>}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <motion.div
        key={`next-${currentIndex}`}
        className={styles.next}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: next?.text.trim() ? 1 : 0, y: 0 }}
        transition={{ duration: switchSec, ease: [0.22, 1, 0.36, 1] }}
        aria-hidden="true"
      >
        {next?.text}
      </motion.div>
    </div>
  )
}
