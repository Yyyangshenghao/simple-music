import { useEffect, useId, useRef, useState, type PointerEvent } from 'react'
import { animate, motion, useMotionTemplate, useMotionValue, useMotionValueEvent, useTransform } from 'motion/react'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import { scrubFieldReturn } from '../../lib/motion-presets'
import styles from './ScrubField.module.css'

/** 拖动多少像素走一个步长。 */
const PX_PER_STEP = 2
/** 拖出范围后橡皮筋最多延伸的量（占整个范围的比例）。 */
const RUBBER_REACH = 0.08
/** 拖出范围时整块最多侧倾的像素。 */
const LEAN = 4
const COARSE = 10
const FINE = 0.1

interface ScrubFieldProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  /** 双击标签恢复的默认值；偏离默认时描一圈细边。 */
  defaultValue: number
  onChange(value: number): void
  /** 显示换算：显示值 = 值 × scale，如百分比传 100。 */
  scale?: number
  suffix?: string
  /** 数值后的补充描述（如「轻柔」）。 */
  note?(value: number): string
  disabled?: boolean
}

const decimalsOf = (n: number) => {
  const text = String(Number(n.toFixed(6)))
  const dot = text.indexOf('.')
  return dot < 0 ? 0 : text.length - dot - 1
}
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/**
 * 拖拽数值框（参考 React Bits ScrubField）：按住左右拖改值（Shift 粗调、Alt 细调），底色随值填充，
 * 拖出范围时橡皮筋延伸并侧倾、松手回弹，拖动中显示相对起点的增减；点击数值可直接输入，双击标签恢复默认。
 */
export function ScrubField({ label, value, min, max, step, defaultValue, onChange, scale = 1, suffix = '', note, disabled }: ScrubFieldProps) {
  const id = useId()
  const reducedMotion = useReducedMotion()
  const [dragging, setDragging] = useState(false)
  const [typing, setTyping] = useState(false)
  const display = useMotionValue(value)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const ghostRef = useRef<HTMLSpanElement>(null)
  const drag = useRef<{ id: number; x: number; raw: number; mult: number; moved: boolean; before: number; left: number } | null>(null)
  const valueRef = useRef(value)
  const draft = useRef('')

  const baseDecimals = decimalsOf(step * scale)
  const fineDecimals = Math.min(6, baseDecimals + 1)
  const fmt = (v: number) => {
    const shown = v * scale
    const scaled = shown * 10 ** baseDecimals
    return shown.toFixed(Math.abs(scaled - Math.round(scaled)) < 1e-6 ? baseDecimals : fineDecimals)
  }
  const reach = RUBBER_REACH * Math.max(max - min, Number.EPSILON)
  const bend = (over: number) => Math.sign(over) * reach * Math.log1p(Math.abs(over) / reach)
  const unbend = (over: number) => Math.sign(over) * reach * Math.expm1(Math.abs(over) / reach)
  const toShown = (raw: number) => { const c = clamp(raw, min, max); return c + bend(raw - c) }
  const toRaw = (shown: number) => { const c = clamp(shown, min, max); return c + unbend(shown - c) }
  const multiplierOf = (e: { shiftKey: boolean; altKey: boolean }) => (e.shiftKey ? COARSE : e.altKey ? FINE : 1)

  const commit = (next: number) => {
    const rounded = clamp(Number((min + Math.round((next - min) / (step * FINE)) * step * FINE).toFixed(8)), min, max)
    if (rounded === valueRef.current) return
    valueRef.current = rounded
    onChange(rounded)
  }

  // 外部值变化（双击复位、恢复默认、其他入口修改）时同步显示。
  useEffect(() => {
    if (drag.current || value === valueRef.current && display.get() === value) return
    valueRef.current = value
    display.jump(value)
  }, [value, display])

  useMotionValueEvent(display, 'change', (d) => {
    // 橡皮筋拉出范围时只让整块侧倾、数字变灰，显示的仍是实际生效的边界值
    if (!typing && inputRef.current) inputRef.current.value = fmt(clamp(d, min, max))
    if (rootRef.current) rootRef.current.dataset.over = d < min || d > max ? 'true' : 'false'
  })
  const fill = useTransform(display, (d) => (clamp(d, min, max) - min) / Math.max(max - min, Number.EPSILON))
  const fillTransform = useMotionTemplate`scaleX(${fill})`
  const lean = useTransform(display, (d) => (reducedMotion ? 0 : clamp((d - clamp(d, min, max)) / reach, -1, 1) * LEAN))

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || drag.current || e.button !== 0 || typing) return
    if (e.pointerType !== 'touch') e.preventDefault()
    display.stop()
    drag.current = {
      id: e.pointerId, x: e.clientX, raw: toRaw(display.get()), mult: multiplierOf(e), moved: false,
      before: valueRef.current, left: rootRef.current?.getBoundingClientRect().left ?? 0,
    }
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* 指针已失效 */ }
  }
  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const g = drag.current
    if (!g || e.pointerId !== g.id) return
    if (!g.moved) {
      if (Math.abs(e.clientX - g.x) < 3) return
      g.moved = true
      g.x = e.clientX
      setDragging(true)
      document.documentElement.style.cursor = 'ew-resize'
    }
    const m = multiplierOf(e)
    if (m !== g.mult) { g.mult = m; g.raw = toRaw(display.get()); g.x = e.clientX }
    const raw = g.raw + Math.round((e.clientX - g.x) / PX_PER_STEP) * step * m
    const shown = toShown(raw)
    display.set(shown)
    commit(clamp(raw, min, max))
    if (ghostRef.current) {
      const delta = (clamp(shown, min, max) - g.before) * scale
      ghostRef.current.style.translate = `calc(${e.clientX - g.left}px - 50%) -100%`
      ghostRef.current.textContent = `${delta < 0 ? '−' : '+'}${Math.abs(delta).toFixed(g.mult === FINE ? fineDecimals : baseDecimals)}${suffix}`
    }
  }
  const end = (cancel: boolean) => {
    const g = drag.current
    if (!g) return
    drag.current = null
    setDragging(false)
    document.documentElement.style.cursor = ''
    if (cancel) { commit(g.before); display.jump(g.before); return }
    // 没拖动：当作点击数值，进入输入
    if (!g.moved) { inputRef.current?.focus(); return }
    const bound = clamp(display.get(), min, max)
    if (display.get() !== bound) {
      if (reducedMotion) display.jump(bound)
      else animate(display, bound, scrubFieldReturn)
    }
  }

  useEffect(() => () => { document.documentElement.style.cursor = '' }, [])

  const leaveTyping = () => {
    setTyping(false)
    if (inputRef.current) inputRef.current.value = fmt(valueRef.current)
  }
  const dirty = Math.abs(value - defaultValue) > step / 2

  return (
    <motion.div
      ref={rootRef}
      className={styles.field}
      data-dirty={dirty || undefined}
      data-dragging={dragging || undefined}
      data-typing={typing || undefined}
      data-disabled={disabled || undefined}
      style={{ x: lean }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={() => end(false)}
      onPointerCancel={() => end(true)}
      onLostPointerCapture={() => end(false)}
    >
      <span className={styles.track} aria-hidden="true">
        <motion.span className={styles.fill} style={{ transform: fillTransform }} />
      </span>
      <label
        htmlFor={id}
        className={styles.label}
        title="双击恢复默认"
        onClick={(e) => e.preventDefault()}
        onDoubleClick={() => { if (!disabled) { commit(defaultValue); display.jump(defaultValue) } }}
      >
        {label}
      </label>
      {note && <span className={styles.note}>{note(value)}</span>}
      <input
        ref={inputRef}
        id={id}
        className={styles.input}
        type="text"
        inputMode="decimal"
        role="spinbutton"
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuetext={`${fmt(value)}${suffix}`}
        defaultValue={fmt(value)}
        disabled={disabled}
        onFocus={(e) => { setTyping(true); draft.current = e.target.value; e.target.select() }}
        onChange={(e) => { draft.current = e.target.value }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() }
          else if (e.key === 'Escape') { e.preventDefault(); draft.current = ''; e.currentTarget.blur() }
        }}
        onBlur={() => {
          const typed = parseFloat(draft.current.replace(/[^\d.-]/g, ''))
          if (!Number.isNaN(typed)) commit(min + Math.round((typed / scale - min) / step) * step)
          draft.current = ''
          leaveTyping()
          display.jump(valueRef.current)
        }}
      />
      {suffix && <span className={styles.suffix} aria-hidden="true">{suffix}</span>}
      <span ref={ghostRef} className={styles.ghost} aria-hidden="true" />
    </motion.div>
  )
}
