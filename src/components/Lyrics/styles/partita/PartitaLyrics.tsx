import { memo, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLyricStyleTuning } from '../../../../stores/lyric-styles'
import { useSettingsStore } from '../../../../stores/settings'
import { partitaLayout, partitaRowsForStage, wordState } from '../../../../lib/lyric-style-layouts'
import { partitaVisual } from '../../../../lib/lyric-style-visuals'
import { StyleStage, useFitToStage, useLyricFrames, useStyleLine, type StyleLine } from '../shared'
import styles from './PartitaLyrics.module.css'

/**
 * 云阶：一句按词组拆成几行，左右交替错开成台阶，每行下方一条带端点刻度的引导线。
 * 整句结构先就位、词以浅色等待；轮到的词放大并发出强调色辉光，所在行的引导线同时点亮；
 * 唱过的词回落到正常字号，结构保留到换句。
 */
interface PartitaTuning {
  step: number
  guides: boolean
  semantic: boolean
  emphasis: number
}

// 强调色（连带文字阴影）量化到 0.05 一档，衰减过程中多数帧不触发重绘。
const step = (value: number) => Math.round(value * 20) / 20

const PartitaLine = memo(function PartitaLine({ line, tuning }: { line: StyleLine; tuning: PartitaTuning }) {
  const contentRef = useRef<HTMLDivElement>(null)
  const wordRefs = useRef<(HTMLSpanElement | null)[]>([])
  const rowRefs = useRef<(HTMLDivElement | null)[]>([])
  // 舞台宽高（以未缩放的基准字号计）：长句按它定台阶级数，矮舞台（例如显示译文时）少分几级。
  const fontScale = useSettingsStore(state => state.lyricsFontScale)
  const [stageEm, setStageEm] = useState<{ width: number; height: number } | null>(null)
  useLayoutEffect(() => {
    const content = contentRef.current
    const stage = content?.closest<HTMLElement>('[data-style-stage]')
    if (!content || !stage) return
    const measure = () => {
      const fit = parseFloat(content.style.getPropertyValue('--style-fit')) || 1
      const em = (parseFloat(getComputedStyle(content).fontSize) || 16) / fit
      const next = { width: Math.round((stage.clientWidth / em) * 10) / 10, height: Math.round((stage.clientHeight / em) * 10) / 10 }
      setStageEm(prev => (prev && prev.width === next.width && prev.height === next.height ? prev : next))
    }
    const observer = new ResizeObserver(measure)
    observer.observe(stage)
    measure()
    return () => observer.disconnect()
  }, [fontScale])
  const rowCount = tuning.semantic && stageEm ? partitaRowsForStage(line.words, stageEm) : undefined
  const rows = useMemo(() => partitaLayout(line.words, line.lineStartMs / 1000, { step: tuning.step, semantic: tuning.semantic, rows: rowCount }),
    [line.words, line.lineStartMs, tuning.step, tuning.semantic, rowCount])
  // 错位用 transform，不计入布局宽度；按最大错位给两侧留白，试排时才会算进去。
  const reach = rows.reduce((max, row) => Math.max(max, Math.abs(row.offset)), 0)
  useFitToStage(contentRef, [rows])

  useLyricFrames(line.lineStartMs, elapsed => {
    rows.forEach((row, r) => {
      let rowHeat = 0
      row.words.forEach(i => {
        const element = wordRefs.current[i]
        if (!element) return
        const v = partitaVisual(wordState(line.words[i], elapsed), { animated: line.animated, emphasis: tuning.emphasis })
        rowHeat = Math.max(rowHeat, v.heat)
        element.style.opacity = String(v.opacity)
        element.style.transform = v.scale !== 1 ? `scale(${v.scale.toFixed(3)})` : ''
        element.style.setProperty('--heat', String(step(v.heat)))
      })
      rowRefs.current[r]?.style.setProperty('--row-heat', String(step(rowHeat)))
    })
  })

  return (
    <div ref={contentRef} className={styles.rows} style={{ paddingInline: `${reach + 0.3}em` }}>
      {rows.map((row, r) => (
        <div key={r} ref={element => { rowRefs.current[r] = element }}
          className={`${styles.row}${tuning.guides ? ` ${styles.guided}` : ''}`}
          style={{ transform: `translateX(${row.offset.toFixed(3)}em)` }}>
          {row.words.map(i => (
            <span key={i} ref={element => { wordRefs.current[i] = element }} className={styles.word}>{line.words[i].text}</span>
          ))}
        </div>
      ))}
    </div>
  )
})

export function PartitaLyrics({ preview = false }: { preview?: boolean }) {
  const line = useStyleLine(preview)
  const raw = useLyricStyleTuning('partita')
  const tuning = useMemo<PartitaTuning>(() => ({
    step: Number(raw.step), guides: raw.guides === true, semantic: raw.semantic === true, emphasis: Number(raw.emphasis),
  }), [raw])
  return (
    <StyleStage line={line} preview={preview}>
      <PartitaLine key={line.key} line={line} tuning={tuning} />
    </StyleStage>
  )
}
