import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import { frame, useMotionValue, useMotionValueEvent, useSpring, useVelocity } from 'motion/react'
import { useMotion } from '../../hooks/useMotion'
import { wakeHeadSpring, wakeSpeedSpring } from '../../lib/motion-presets'
import styles from './WakeSlider.module.css'

/** 填充头速度达到此值（百分比/秒）时波峰升到最高。 */
const FULL_SPEED = 320
/** 静止时波峰覆盖的竖条数（半径），拖得越快越宽，最宽 REACH。 */
const MIN_REACH = 1.5
const REACH = 5
/** 波峰向拖动反方向拖出尾迹的偏斜程度。 */
const SKEW = 0.6
/** 振幅低于此值视为静止，跳过逐条重绘。 */
const FLAT = 0.002

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const smoothstep = (s: number) => s * s * (3 - 2 * s)

interface WakeSliderProps {
  value: number
  min?: number
  max: number
  step?: number
  onChange(value: number): void
  /** 拖动开始 / 结束时回调，用于拖动期间保持外层弹出不收起。 */
  onDragChange?(dragging: boolean): void
  ariaLabel: string
  ariaValueText?(value: number): string
  /** 竖条数量。 */
  bars?: number
  disabled?: boolean
  className?: string
}

/**
 * 尾迹滑块（参考 React Bits WakeSlider）：一排竖条表示数值，拖动时填充头附近的竖条随速度隆起成波峰，
 * 静止后回落。仅在数值变化时按帧重绘；减弱动态时不起波峰。
 */
export function WakeSlider({
  value, min = 0, max, step, onChange, onDragChange, ariaLabel, ariaValueText, bars = 18, disabled, className
}: WakeSliderProps) {
  const reducedMotion = !useMotion('sliderMotion')
  const clamped = clamp(value, min, max)
  const pct = max > min ? ((clamped - min) / (max - min)) * 100 : 0
  const trackRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<HTMLDivElement>(null)
  const barEls = useRef<(HTMLSpanElement | null)[]>([])
  const pointerId = useRef<number | null>(null)
  const lastAmp = useRef(0)
  const latest = useRef(clamped)
  latest.current = clamped

  const target = useMotionValue(pct)
  const head = useSpring(target, wakeHeadSpring)
  const speed = useSpring(useVelocity(head), wakeSpeedSpring)

  useEffect(() => { target.set(pct) }, [pct, target])

  const paint = (force = false) => {
    const h = ((reducedMotion ? target.get() : head.get()) / 100) * (bars - 1)
    const v = reducedMotion ? 0 : speed.get()
    const amp = smoothstep(clamp(Math.abs(v) / FULL_SPEED, 0, 1))
    const dir = Math.sign(v) || 1
    const reach = MIN_REACH + (REACH - MIN_REACH) * amp
    const behind = reach * (1 + SKEW)
    const ahead = reach * (1 - 0.5 * SKEW)
    const lit = Math.round(h)
    const flat = !force && amp < FLAT && lastAmp.current < FLAT
    for (let i = 0; i < bars; i++) {
      const el = barEls.current[i]
      if (!el) continue
      const on = i <= lit && pct > 0 ? 'true' : 'false'
      if (el.dataset.on !== on) el.dataset.on = on
      if (flat) continue
      const d = i - h
      const r = d * dir < 0 ? behind : ahead
      const lift = Math.abs(d) < r ? amp * Math.cos((Math.PI * d) / (2 * r)) ** 2 : 0
      el.style.setProperty('--wake-lift', String(lift))
    }
    lastAmp.current = amp
  }
  const paintRef = useRef(paint)
  paintRef.current = paint
  const run = useCallback(() => paintRef.current(), [])
  const schedule = useCallback(() => frame.render(run, false, true), [run])
  useMotionValueEvent(head, 'change', schedule)
  useMotionValueEvent(speed, 'change', schedule)
  useLayoutEffect(() => { paintRef.current(true) })

  const commit = (next: number) => {
    const stepped = step ? min + Math.round((next - min) / step) * step : next
    const clean = clamp(stepped, min, max)
    if (clean === latest.current) return
    latest.current = clean
    onChange(clean)
  }
  const commitFromX = (x: number) => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect?.width) return
    commit(min + clamp((x - rect.left) / rect.width, 0, 1) * (max - min))
  }
  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerId !== pointerId.current) return
    try { event.currentTarget.releasePointerCapture(event.pointerId) } catch { /* 已释放 */ }
    pointerId.current = null
    onDragChange?.(false)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return
    const unit = step ?? (max - min) / 100
    const jumps: Record<string, number> = {
      ArrowRight: clamped + unit, ArrowUp: clamped + unit, ArrowLeft: clamped - unit, ArrowDown: clamped - unit,
      PageUp: clamped + unit * 10, PageDown: clamped - unit * 10, Home: min, End: max
    }
    if (!(event.key in jumps)) return
    event.preventDefault()
    commit(jumps[event.key])
  }

  const barNodes = useMemo(() => {
    barEls.current.length = bars
    return Array.from({ length: bars }, (_, i) => (
      <span key={i} ref={(el) => { barEls.current[i] = el }} className={styles.bar} />
    ))
  }, [bars])

  return (
    <div
      ref={trackRef}
      className={`${styles.track}${className ? ` ${className}` : ''}`}
      aria-disabled={disabled || undefined}
      style={{ '--wake-bars': bars } as CSSProperties}
      onPointerDown={(event) => {
        if (disabled || event.button !== 0 || pointerId.current !== null) return
        pointerId.current = event.pointerId
        try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* 指针已失效 */ }
        handleRef.current?.focus({ preventScroll: true })
        onDragChange?.(true)
        commitFromX(event.clientX)
      }}
      onPointerMove={(event) => { if (event.pointerId === pointerId.current) commitFromX(event.clientX) }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
    >
      {barNodes}
      <div
        ref={handleRef}
        role="slider"
        className={styles.handle}
        tabIndex={disabled ? -1 : 0}
        aria-label={ariaLabel}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={clamped}
        aria-valuetext={ariaValueText?.(clamped)}
        aria-disabled={disabled || undefined}
        onKeyDown={onKeyDown}
      />
    </div>
  )
}
