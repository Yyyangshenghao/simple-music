import { memo, useMemo, useRef } from 'react'
import { useLyricStyleTuning } from '../../../../stores/lyric-styles'
import { luminousLayout, wordState } from '../../../../lib/lyric-style-layouts'
import { luminousVisual } from '../../../../lib/lyric-style-visuals'
import { StyleStage, useBeatPulse, useFitToStage, useLyricFrames, useStyleLine, type StyleLine } from '../shared'
import styles from './LuminousLyrics.module.css'

/**
 * 流光：整句的词按种子松散散布，每个词经历 等待 → 演唱 → 唱后 三态。
 * 等待时淡而略低，临近开唱前浮起；演唱时发光、荡开一圈涟漪；唱后留一段余晖并缓慢上漂。
 */
interface LuminousTuning {
  spread: number
  glow: number
  breath: number
  rotation: boolean
  ripple: boolean
  beat: boolean
}

// 辉光与强调色量化到 0.05 一档：值不变的帧不触发文字阴影重绘。
const step = (value: number) => Math.round(value * 20) / 20

const LuminousLine = memo(function LuminousLine({ line, tuning }: { line: StyleLine; tuning: LuminousTuning }) {
  const contentRef = useRef<HTMLDivElement>(null)
  const wordRefs = useRef<(HTMLSpanElement | null)[]>([])
  const ringRefs = useRef<(HTMLSpanElement | null)[]>([])
  const poses = useMemo(() => luminousLayout(line.words, line.lineStartMs / 1000, { spread: tuning.spread, rotation: tuning.rotation }),
    [line.words, line.lineStartMs, tuning.spread, tuning.rotation])
  const pulse = useBeatPulse(tuning.beat && line.animated)
  // 流光自动换行：宽度由换行兜住，涟漪圈与逐帧位移不应计入，只按高度试排。
  useFitToStage(contentRef, [line.words, poses], { checkWidth: false })

  useLyricFrames(line.lineStartMs, (elapsed, now) => {
    const beat = pulse(now)
    const breathT = now / 1000
    line.words.forEach((word, i) => {
      const element = wordRefs.current[i]
      if (!element) return
      const pose = poses[i]
      const v = luminousVisual(wordState(word, elapsed), { animated: line.animated, glow: tuning.glow, ripple: tuning.ripple, beat })
      const breath = line.animated ? Math.sin(breathT * 0.9 + pose.phase) * 0.05 * tuning.breath : 0
      element.style.opacity = String(v.opacity)
      element.style.transform = `translate(${pose.x}em, ${(pose.y + v.lift + breath).toFixed(3)}em) rotate(${pose.rotate}deg) scale(${v.scale.toFixed(3)})`
      element.style.filter = v.blur > 0.05 ? `blur(${v.blur.toFixed(2)}px)` : ''
      const glow = step(v.glow)
      element.style.setProperty('--heat', String(step(v.heat)))
      element.style.textShadow = glow > 0 ? `0 0 ${(0.22 * glow).toFixed(3)}em var(--style-accent), 0 0 ${(0.6 * glow).toFixed(3)}em var(--style-accent-soft)` : ''
      const ring = ringRefs.current[i]
      if (ring) {
        ring.style.opacity = v.ripple < 1 ? String(0.32 * (1 - v.ripple) * (1 - v.ripple) * (1 + beat * 0.5)) : '0'
        ring.style.transform = `translate(-50%, -50%) scale(${(0.6 + 1.1 * v.ripple).toFixed(3)})`
      }
    })
  })

  return (
    <div ref={contentRef} className={styles.words} style={{ '--word-gap': `${0.12 + tuning.spread * 0.12}em` } as React.CSSProperties}>
      {line.words.map((word, i) => (
        <span key={i} ref={element => { wordRefs.current[i] = element }} className={styles.word}>
          {tuning.ripple && <span ref={element => { ringRefs.current[i] = element }} className={styles.ring} aria-hidden="true" />}
          {word.text}
        </span>
      ))}
    </div>
  )
})

export function LuminousLyrics({ preview = false }: { preview?: boolean }) {
  const line = useStyleLine(preview)
  const raw = useLyricStyleTuning('luminous')
  const tuning = useMemo<LuminousTuning>(() => ({
    spread: Number(raw.spread), glow: Number(raw.glow), breath: Number(raw.breath),
    rotation: raw.rotation === true, ripple: raw.ripple === true, beat: raw.beat === true,
  }), [raw])
  return (
    <StyleStage line={line} preview={preview}>
      <LuminousLine key={line.key} line={line} tuning={tuning} />
    </StyleStage>
  )
}
