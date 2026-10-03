import { useEffect, useMemo, useRef } from 'react'
import type { WordLyricLine } from '../../types/domain'
import { createWordHighlightTimeline, hasWordTiming } from '../../lib/word-highlight-timeline'
import styles from './DesktopLyrics.module.css'
import { fontFamilyCssValue } from '../../lib/font-family'
import { DESKTOP_LYRICS_GAP, DESKTOP_LYRICS_LINE_HEIGHT, DESKTOP_LYRICS_TRANSLATION_SCALE } from '../../lib/desktop-lyrics-layout'

interface DesktopLyricsProps {
  line: string
  nextLine?: string
  wordLine?: WordLyricLine
  wordClock?: { elapsedMs: number; playing: boolean; rate: number }
  translation?: string
  roma?: string
  size?: number
  highlight?: boolean
  fontFamily?: string
  fontFamilyCjk?: string
  color?: string
  opacity?: number
  fitHeight?: boolean
}

/** 桌面歌词展示（overlay 窗口内用，纯展示）。 */
export function DesktopLyrics({ line, nextLine, wordLine, wordClock, translation, roma, size = 38, highlight = true, fontFamily = '', fontFamilyCjk = '', color = '#ffffff', opacity = 0.92, fitHeight = false }: DesktopLyricsProps) {
  const wordsRef = useRef<HTMLDivElement>(null)
  const clockRef = useRef({ elapsedMs: 0, playing: false, rate: 1, receivedAt: 0 })
  const timelineRef = useRef<ReturnType<typeof createWordHighlightTimeline>>(null)
  // IPC 会重新序列化整份状态；相同时序复用词列表，避免每次时钟更新重建动画。
  const wordsKey = JSON.stringify(wordLine?.words || [])
  const words = useMemo(() => JSON.parse(wordsKey) as WordLyricLine['words'], [wordsKey])
  const timed = !!wordClock && Number.isFinite(wordClock.elapsedMs) && hasWordTiming(words)
    && words.map(word => word.text).join('') === line

  useEffect(() => {
    if (!wordClock) return
    clockRef.current = { ...wordClock, receivedAt: performance.now() }
    timelineRef.current?.seek(wordClock.elapsedMs)
  }, [wordClock])

  useEffect(() => {
    if (!timed || !wordsRef.current) return
    const elements = Array.from(wordsRef.current.querySelectorAll('[data-desktop-lyrics-word-fill]'))
    const timeline = createWordHighlightTimeline(elements, words)
    if (!timeline) return
    timelineRef.current = timeline
    let raf = 0
    const sync = () => {
      const clock = clockRef.current
      const delta = clock.playing ? Math.min(150, Math.max(0, performance.now() - clock.receivedAt)) : 0
      const rate = Number.isFinite(clock.rate) && clock.rate > 0 ? clock.rate : 1
      timeline.seek(clock.elapsedMs + delta * rate)
      raf = requestAnimationFrame(sync)
    }
    sync()
    return () => {
      cancelAnimationFrame(raf)
      timeline.dispose()
      timelineRef.current = null
    }
  }, [timed, words])

  const secondaryLines = Number(!!translation) + Number(!!roma)
  const primaryLines = 1 + Number(!!nextLine)
  const gaps = primaryLines + secondaryLines - 1
  const fontSize = fitHeight
    ? `calc((100cqh - 8px - ${gaps * DESKTOP_LYRICS_GAP}px) / ${DESKTOP_LYRICS_LINE_HEIGHT * (primaryLines + secondaryLines * DESKTOP_LYRICS_TRANSLATION_SCALE)})`
    : size
  return (
    <div className={styles.wrap} style={{ fontSize, opacity: Number.isFinite(opacity) ? Math.max(0.28, Math.min(1, opacity)) : 0.92, fontFamily: fontFamilyCssValue(fontFamily, fontFamilyCjk), color: /^#[\da-f]{6}$/i.test(color) ? color : '#ffffff' }}>
      <div
        ref={wordsRef}
        data-desktop-lyrics-text
        className={`${styles.line}${highlight ? ` ${styles.glow}` : ''}`}
      >
        {timed ? words.map((word, index) => (
          <span className={styles.word} key={index}>
            <span className={styles.wordBase}>{word.text}</span>
            <span data-desktop-lyrics-word-fill className={styles.wordFill} aria-hidden="true">{word.text}</span>
          </span>
        )) : line || '♪'}
      </div>
      {nextLine ? <div data-desktop-lyrics-text className={`${styles.line} ${styles.nextLine}`}>{nextLine}</div> : null}
      {roma ? <div data-desktop-lyrics-text className={styles.translation}>{roma}</div> : null}
      {translation ? (
        <div data-desktop-lyrics-text className={styles.translation}>
          {translation}
        </div>
      ) : null}
    </div>
  )
}
