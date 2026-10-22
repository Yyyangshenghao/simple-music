import { memo, useMemo, useRef } from 'react'
import { useLyricStyleTuning } from '../../../../stores/lyric-styles'
import { tiltLayout, wordState } from '../../../../lib/lyric-style-layouts'
import { tiltVisual } from '../../../../lib/lyric-style-visuals'
import { StyleStage, useFitToStage, useLyricFrames, useStyleLine, type StyleLine } from '../shared'
import styles from './TiltLyrics.module.css'

/**
 * 倾诉：一句拆成 1–4 行，正体与细斜体交替出现。斜体行用强调色，字符上下交替错位；
 * 各词按演唱时间依次浮现，正在唱的词提亮，唱过的回到所在行的颜色。
 */
interface TiltTuning {
  split: number
  tilt: number
  offset: number
}

// 强调色（连带文字阴影）量化到 0.05 一档，衰减过程中多数帧不触发重绘。
const step = (value: number) => Math.round(value * 20) / 20

const TiltLine = memo(function TiltLine({ line, tuning }: { line: StyleLine; tuning: TiltTuning }) {
  const contentRef = useRef<HTMLDivElement>(null)
  const wordRefs = useRef<(HTMLSpanElement | null)[]>([])
  const rows = useMemo(() => tiltLayout(line.words, line.lineStartMs / 1000, { split: tuning.split, tilt: tuning.tilt }),
    [line.words, line.lineStartMs, tuning.split, tuning.tilt])
  // 斜体行里逐词交替上下错位；正体行保持平直。
  const shifts = useMemo(() => {
    const result = new Array<number>(line.words.length).fill(0)
    for (const row of rows) {
      if (!row.italic) continue
      row.words.forEach((wordIndex, i) => { result[wordIndex] = (i % 2 ? 1 : -1) * 0.12 * tuning.offset })
    }
    return result
  }, [rows, line.words.length, tuning.offset])
  useFitToStage(contentRef, [rows])

  useLyricFrames(line.lineStartMs, elapsed => {
    line.words.forEach((word, i) => {
      const element = wordRefs.current[i]
      if (!element) return
      const v = tiltVisual(wordState(word, elapsed), line.animated)
      element.style.opacity = String(v.opacity)
      element.style.transform = `translateY(${(shifts[i] + v.rise).toFixed(3)}em)`
      element.style.filter = v.blur > 0.05 ? `blur(${v.blur.toFixed(2)}px)` : ''
      element.style.setProperty('--heat', String(step(v.heat)))
    })
  })

  return (
    <div ref={contentRef} className={styles.rows}>
      {rows.map((row, r) => (
        <div key={r} className={`${styles.row}${row.italic ? ` ${styles.italic}` : ''}`}>
          {row.words.map(i => (
            <span key={i} ref={element => { wordRefs.current[i] = element }} className={styles.word}>{line.words[i].text}</span>
          ))}
        </div>
      ))}
    </div>
  )
})

export function TiltLyrics({ preview = false }: { preview?: boolean }) {
  const line = useStyleLine(preview)
  const raw = useLyricStyleTuning('tilt')
  const tuning = useMemo<TiltTuning>(() => ({ split: Number(raw.split), tilt: Number(raw.tilt), offset: Number(raw.offset) }), [raw])
  return (
    <StyleStage line={line} preview={preview}>
      <TiltLine key={line.key} line={line} tuning={tuning} />
    </StyleStage>
  )
}
