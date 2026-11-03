import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { animate, motion, useMotionTemplate, useMotionValue, useMotionValueEvent, useTransform } from 'motion/react'
import { useMotion } from '../../hooks/useMotion'
import { scrubFieldReturn } from '../../lib/motion-presets'
import styles from './ScrubField.module.css'

/** 拖出范围后橡皮筋最多延伸的量（占整个范围的比例）。 */
const RUBBER_REACH = 0.08
/** 拖出范围时整块最多侧倾的像素。 */
const LEAN = 4
/** Alt 细调：指针走一段，值只走十分之一。 */
const FINE = 0.1
/** 按下后移动超过这个距离才算拖动，否则按点击处理。 */
const DRAG_SLOP = 3

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
 * 拖拽数值条（参考 React Bits ScrubField）：整条就是滑轨，底色按值填充。
 * 左右拖动时填充边缘与指针 1:1 跟手（Alt 细调），点一下直接跳到该位置；
 * 拖出范围时橡皮筋延伸并侧倾、松手回弹，拖动中显示相对起点的增减；双击标签恢复默认。
 */
export function ScrubField({ label, value, min, max, step, defaultValue, onChange, scale = 1, suffix = '', note, disabled }: ScrubFieldProps) {
  const reducedMotion = !useMotion('sliderMotion')
  const [dragging, setDragging] = useState(false)
  const display = useMotionValue(value)
  const rootRef = useRef<HTMLDivElement>(null)
  const valueRef = useRef(value)
  const outputRef = useRef<HTMLSpanElement>(null)
  const ghostRef = useRef<HTMLSpanElement>(null)
  const drag = useRef<{ id: number; x: number; raw: number; fine: boolean; moved: boolean; before: number; left: number; width: number; onLabel: boolean } | null>(null)

  const span = Math.max(max - min, Number.EPSILON)
  const baseDecimals = decimalsOf(step * scale)
  const fineDecimals = Math.min(6, baseDecimals + 1)
  const fmt = (v: number) => {
    const shown = v * scale
    const scaled = shown * 10 ** baseDecimals
    return shown.toFixed(Math.abs(scaled - Math.round(scaled)) < 1e-6 ? baseDecimals : fineDecimals)
  }
  const reach = RUBBER_REACH * span
  const bend = (over: number) => Math.sign(over) * reach * Math.log1p(Math.abs(over) / reach)
  const unbend = (over: number) => Math.sign(over) * reach * Math.expm1(Math.abs(over) / reach)
  const toShown = (raw: number) => { const c = clamp(raw, min, max); return c + bend(raw - c) }
  const toRaw = (shown: number) => { const c = clamp(shown, min, max); return c + unbend(shown - c) }

  const snap = (next: number, fine: boolean) => {
    const unit = fine ? step * FINE : step
    return clamp(Number((min + Math.round((next - min) / unit) * unit).toFixed(8)), min, max)
  }
  const commit = (next: number) => {
    if (next === valueRef.current) return
    valueRef.current = next
    onChange(next)
  }

  // 外部值变化（双击复位、恢复默认、其他入口修改）时同步显示。
  useEffect(() => {
    if (drag.current || value === valueRef.current && display.get() === value) return
    valueRef.current = value
    display.jump(value)
  }, [value, display])

  useMotionValueEvent(display, 'change', (d) => {
    // 橡皮筋拉出范围时只让整块侧倾、数字变灰，显示的仍是实际生效的边界值
    if (outputRef.current) outputRef.current.textContent = fmt(snap(clamp(d, min, max), true))
    if (rootRef.current) rootRef.current.dataset.over = d < min || d > max ? 'true' : 'false'
  })
  const fill = useTransform(display, (d) => (clamp(d, min, max) - min) / span)
  const fillTransform = useMotionTemplate`scaleX(${fill})`
  const lean = useTransform(display, (d) => (reducedMotion ? 0 : clamp((d - clamp(d, min, max)) / reach, -1, 1) * LEAN))

  const labelHit = (x: number) => {
    const rect = rootRef.current?.querySelector(`.${styles.label}`)?.getBoundingClientRect()
    return rect && x >= rect.left && x <= rect.right
  }

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || drag.current || e.button !== 0) return
    if (e.pointerType !== 'touch') e.preventDefault()
    display.stop()
    const rect = rootRef.current?.getBoundingClientRect()
    drag.current = {
      id: e.pointerId, x: e.clientX, raw: toRaw(display.get()), fine: e.altKey, moved: false,
      before: valueRef.current, left: rect?.left ?? 0, width: Math.max(1, rect?.width ?? 1),
      // 标签留给双击复位：点标签不跳值，但从标签上按住拖动照常生效。
      onLabel: !!labelHit(e.clientX),
    }
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* 指针已失效 */ }
  }
  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const g = drag.current
    if (!g || e.pointerId !== g.id) return
    // 在窗口外松开可能收不到 pointerup：键已抬起就按松手处理。
    if ((e.buttons & 1) === 0) { end(false); return }
    if (!g.moved) {
      if (Math.abs(e.clientX - g.x) < DRAG_SLOP) return
      g.moved = true
      g.x = e.clientX
      setDragging(true)
      document.documentElement.style.cursor = 'ew-resize'
    }
    // 切换细调时以当前位置为新起点，避免跳变。
    if (e.altKey !== g.fine) { g.fine = e.altKey; g.raw = toRaw(display.get()); g.x = e.clientX }
    const raw = g.raw + (e.clientX - g.x) / g.width * span * (g.fine ? FINE : 1)
    const shown = toShown(raw)
    display.set(shown)
    commit(snap(raw, g.fine))
    if (ghostRef.current) {
      const delta = (snap(clamp(shown, min, max), g.fine) - g.before) * scale
      ghostRef.current.style.translate = `calc(${e.clientX - g.left}px - 50%) -100%`
      ghostRef.current.textContent = `${delta < 0 ? '−' : '+'}${Math.abs(delta).toFixed(g.fine ? fineDecimals : baseDecimals)}${suffix}`
    }
  }
  const end = (cancel: boolean) => {
    const g = drag.current
    if (!g) return
    drag.current = null
    setDragging(false)
    document.documentElement.style.cursor = ''
    if (cancel) { commit(g.before); display.jump(g.before); return }
    // 没拖动：当作点击，值滑到点下的位置。
    if (!g.moved) {
      if (g.onLabel) return
      const target = snap(min + clamp((g.x - g.left) / g.width, 0, 1) * span, false)
      commit(target)
      if (reducedMotion) display.jump(target)
      else animate(display, target, scrubFieldReturn)
      return
    }
    // 拖动中 display 是未取整的连续值：松手后回到实际生效的取整值（拖出范围时即回弹到边界）。
    const settled = valueRef.current
    if (display.get() !== settled) {
      if (reducedMotion) display.jump(settled)
      else animate(display, settled, scrubFieldReturn)
    }
  }

  useEffect(() => () => { document.documentElement.style.cursor = '' }, [])

  const dirty = Math.abs(value - defaultValue) > step / 2

  return (
    <motion.div
      ref={rootRef}
      className={styles.field}
      role="slider"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuetext={`${fmt(value)}${suffix}`}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      // 去掉输入框后键盘仍可调：方向键走一个步长（Alt 细调），Home/End 到两端。
      onKeyDown={(e) => {
        if (disabled || drag.current) return
        const unit = e.altKey ? step * FINE : step
        const next = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? valueRef.current + unit
          : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? valueRef.current - unit
            : e.key === 'Home' ? min : e.key === 'End' ? max : null
        if (next === null) return
        e.preventDefault()
        const target = snap(next, e.altKey)
        commit(target)
        display.jump(target)
      }}
      data-dirty={dirty || undefined}
      data-dragging={dragging || undefined}
      data-disabled={disabled || undefined}
      style={{ x: lean }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={() => end(false)}
      onPointerCancel={() => end(true)}
      onLostPointerCapture={() => end(false)}
      // 按下时整条抓住了指针，双击事件落在整条上：按坐标判断是否双击在标签上。
      onDoubleClick={(e) => {
        if (disabled || !labelHit(e.clientX)) return
        commit(defaultValue)
        if (reducedMotion) display.jump(defaultValue)
        else animate(display, defaultValue, scrubFieldReturn)
      }}
    >
      <span className={styles.track} aria-hidden="true">
        <motion.span className={styles.fill} style={{ transform: fillTransform }} />
      </span>
      <span className={styles.label} title="双击恢复默认">
        {label}
      </span>
      {note && <span className={styles.note}>{note(value)}</span>}
      <span ref={outputRef} className={styles.value} aria-hidden="true">{fmt(value)}</span>
      {suffix && <span className={styles.suffix} aria-hidden="true">{suffix}</span>}
      <span ref={ghostRef} className={styles.ghost} aria-hidden="true" />
    </motion.div>
  )
}
