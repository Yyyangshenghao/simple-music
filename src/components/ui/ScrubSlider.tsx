import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import styles from './ScrubSlider.module.css'

/** 拖出两端时轨道最多拉伸的像素，越拉越费劲（sigmoid 衰减）。 */
const MAX_STRETCH = 5
/** commit 模式松手后，外部值迟迟不回传（如迷你条经 IPC seek）时最多保留预览值的时长。 */
const SETTLE_MS = 900

interface ScrubSliderProps {
  value: number
  min?: number
  max: number
  step?: number
  /**
   * live：拖动中持续 onChange（音量）；
   * commit：拖动只预览，松手才 onChange（播放进度，避免逐帧 seek 造成卡顿与爆音）。
   */
  mode?: 'live' | 'commit'
  onChange(value: number): void
  /** 拖动中的预览值，结束或取消时回调 null；用于同步时间文字。 */
  onPreview?(value: number | null): void
  /** 提供时显示数值气泡。 */
  format?(value: number): string
  /** hover：悬停与拖动时都显示气泡；drag：只在拖动（或 showBubble）时显示。 */
  bubble?: 'hover' | 'drag'
  /** 外部要求临时显示气泡（如滚轮调节时）。 */
  showBubble?: boolean
  /** vertical：自下而上增大，气泡在轨道左侧。 */
  orientation?: 'horizontal' | 'vertical'
  ariaLabel: string
  ariaValueText?(value: number): string
  size?: 'regular' | 'compact'
  /** capsule：常态即为有体积的圆角胶囊，不显示滑块（无底框的音量条）。 */
  variant?: 'line' | 'capsule'
  disabled?: boolean
  className?: string
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function decay(overflow: number): number {
  const sign = Math.sign(overflow)
  return sign * 2 * (1 / (1 + Math.exp(-Math.abs(overflow) / MAX_STRETCH)) - 0.5) * MAX_STRETCH
}

/**
 * 统一的进度/音量拖动条：悬停加粗并显示滑块与预览气泡，点按平滑跳转，拖动跟手，
 * 拖出两端轨道橡皮筋拉伸、松手回弹。应用全局屏蔽控件键盘操作，这里不处理按键。
 */
export function ScrubSlider({
  value, min = 0, max, step, mode = 'live', onChange, onPreview, format, bubble = 'hover', showBubble,
  ariaLabel, ariaValueText, size = 'regular', variant = 'line', orientation = 'horizontal', disabled, className
}: ScrubSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ pointerId: number; value: number; moved: boolean } | null>(null)
  const settleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [dragValue, setDragValue] = useState<number | null>(null)
  const [settleValue, setSettleValue] = useState<number | null>(null)
  const [hoverRatio, setHoverRatio] = useState<number | null>(null)
  const [jumping, setJumping] = useState(false)
  const [stretch, setStretch] = useState(0)
  const range = max - min

  // 外部值一变化（seek 已生效）就放弃保留的预览值。
  useEffect(() => {
    setSettleValue(null)
  }, [value])
  useEffect(() => () => clearTimeout(settleTimer.current), [])

  const shown = dragValue ?? settleValue ?? value
  const ratio = range > 0 ? clamp01((shown - min) / range) : 0
  const dragging = dragValue !== null

  function quantize(next: number): number {
    const stepped = step ? min + Math.round((next - min) / step) * step : next
    return Math.min(max, Math.max(min, stepped))
  }

  const vertical = orientation === 'vertical'

  /** 指针位置换算成值；overflow 为拖出轨道的像素，正数在增大端、负数在起点端。 */
  function read(event: PointerEvent<HTMLDivElement>): { value: number; overflow: number; ratio: number } {
    const rect = trackRef.current?.getBoundingClientRect()
    const length = vertical ? rect?.height : rect?.width
    if (!rect || !length || length <= 0 || range <= 0) return { value: shown, overflow: 0, ratio }
    const offset = vertical ? rect.bottom - event.clientY : event.clientX - rect.left
    const overflow = offset < 0 ? offset : offset > length ? offset - length : 0
    const r = clamp01(offset / length)
    return { value: quantize(min + r * range), overflow, ratio: r }
  }

  function update(next: number): void {
    if (dragRef.current) dragRef.current.value = next
    setDragValue(next)
    onPreview?.(next)
    if (mode === 'live') onChange(next)
  }

  function finish(commit: boolean): void {
    const drag = dragRef.current
    if (!drag) return
    dragRef.current = null
    if (commit && mode === 'commit') {
      onChange(drag.value)
      setSettleValue(drag.value)
      clearTimeout(settleTimer.current)
      settleTimer.current = setTimeout(() => setSettleValue(null), SETTLE_MS)
    } else if (!commit && mode === 'live') {
      onChange(drag.value)
    }
    setDragValue(null)
    setJumping(false)
    setStretch(0)
    onPreview?.(null)
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>): void {
    if (disabled || event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    const hit = read(event)
    dragRef.current = { pointerId: event.pointerId, value: hit.value, moved: false }
    setJumping(true)
    update(hit.value)
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>): void {
    const hit = read(event)
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) {
      if (event.pointerType === 'mouse' && !disabled) setHoverRatio(hit.ratio)
      return
    }
    if (!drag.moved) {
      drag.moved = true
      setJumping(false)
    }
    setStretch(decay(hit.overflow))
    if (hit.value !== drag.value) update(hit.value)
  }

  const bubbleRatio = dragging || showBubble ? ratio : bubble === 'hover' ? hoverRatio : null
  const style = {
    '--scrub-ratio': ratio,
    '--scrub-hover': hoverRatio ?? 0,
    '--scrub-bubble': bubbleRatio ?? ratio,
    '--scrub-stretch': `${stretch}px`,
    '--scrub-shift-x': vertical ? '0px' : `${stretch}px`,
    '--scrub-shift-y': vertical ? `${-stretch}px` : '0px',
  } as CSSProperties

  return (
    <div
      className={`${styles.root} no-drag${className ? ` ${className}` : ''}`}
      style={style}
      data-size={size}
      data-variant={variant}
      data-orientation={orientation}
      data-dragging={dragging || undefined}
      data-jumping={jumping || undefined}
      data-hover={hoverRatio !== null || undefined}
      data-stretch={stretch < 0 ? 'start' : stretch > 0 ? 'end' : undefined}
      data-disabled={disabled || undefined}
      role="slider"
      aria-label={ariaLabel}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-orientation={orientation}
      aria-valuenow={Math.round(shown * 1000) / 1000}
      aria-valuetext={ariaValueText?.(shown) ?? format?.(shown)}
      aria-disabled={disabled || undefined}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={() => finish(true)}
      onPointerCancel={() => finish(true)}
      onLostPointerCapture={() => finish(true)}
      onPointerLeave={() => setHoverRatio(null)}
    >
      <div ref={trackRef} className={styles.track}>
        <div className={styles.rail}>
          <div className={styles.ghost} />
          <div className={styles.fill} />
        </div>
        <div className={styles.thumb} />
        {format && range > 0 && (
          <div className={styles.bubble} data-visible={bubbleRatio !== null || undefined} aria-hidden="true">
            {format(dragging || showBubble ? shown : quantize(min + (bubbleRatio ?? ratio) * range))}
          </div>
        )}
      </div>
    </div>
  )
}
