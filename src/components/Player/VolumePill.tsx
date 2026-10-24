import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react'
import { animate, motion, useMotionValue, useTransform } from 'motion/react'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import styles from './VolumePill.module.css'

/** 拖出两端时胶囊最多拉长的像素（sigmoid 衰减，越拉越费劲）。 */
const MAX_STRETCH = 14
/** 位移小于此值视为轻点：跳到点按位置。 */
const TAP_SLOP = 3

interface VolumePillProps {
  /** 0–1。 */
  value: number
  onChange(value: number): void
  /** 底部图标，会在填充层内再渲染一份反色版本。 */
  icon: ReactNode
  /** 外部要求显示百分比（如滚轮调节时）。 */
  showValue?: boolean
  /** 拖动开始/结束，供外层在拖动中保持弹层打开。 */
  onDragChange?(dragging: boolean): void
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function decay(overflow: number): number {
  return Math.sign(overflow) * 2 * (1 / (1 + Math.exp(-Math.abs(overflow) / MAX_STRETCH)) - 0.5) * MAX_STRETCH
}

/**
 * 胶囊式竖向音量：整条胶囊即音量，自底向上填充，被覆盖的图标与数字反色。
 * 拖动按位移相对调整（按下不跳值），轻点才跳到点按位置；拖出两端胶囊拉长收窄、松手回弹。
 */
export function VolumePill({ value, onChange, icon, showValue, onDragChange }: VolumePillProps) {
  const reducedMotion = useReducedMotion()
  const rootRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ pointerId: number; startY: number; startValue: number; moved: boolean } | null>(null)
  const [dragging, setDragging] = useState(false)
  const stretch = useMotionValue(0)
  // 拉伸时沿受力方向变长、略微收窄，像被拽住的橡皮筋。
  const scaleY = useTransform(stretch, (s) => 1 + Math.abs(s) / 168)
  const scaleX = useTransform(stretch, (s) => 1 - Math.abs(s) / 420)
  const originY = useTransform(stretch, (s) => (s > 0 ? 1 : 0))

  useEffect(() => () => stretch.stop(), [stretch])

  const ratio = clamp01(value)
  const percent = Math.round(ratio * 100)

  function release(): void {
    const drag = dragRef.current
    if (!drag) return
    dragRef.current = null
    setDragging(false)
    onDragChange?.(false)
    if (reducedMotion) stretch.jump(0)
    else animate(stretch, 0, { type: 'spring', stiffness: 520, damping: 18, mass: 0.7 })
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { pointerId: event.pointerId, startY: event.clientY, startValue: ratio, moved: false }
    setDragging(true)
    onDragChange?.(true)
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>): void {
    const drag = dragRef.current
    const rect = rootRef.current?.getBoundingClientRect()
    if (!drag || drag.pointerId !== event.pointerId || !rect?.height) return
    const dy = drag.startY - event.clientY
    if (!drag.moved && Math.abs(dy) < TAP_SLOP) return
    drag.moved = true
    const raw = drag.startValue + dy / rect.height
    const overflowPx = (raw > 1 ? raw - 1 : raw < 0 ? raw : 0) * rect.height
    stretch.jump(decay(overflowPx))
    const next = Math.round(clamp01(raw) * 100) / 100
    if (next !== ratio) onChange(next)
  }

  function handlePointerUp(event: PointerEvent<HTMLDivElement>): void {
    const drag = dragRef.current
    const rect = rootRef.current?.getBoundingClientRect()
    if (drag && !drag.moved && rect?.height) {
      // 轻点：填充层借过渡平滑跳到点按位置。
      onChange(Math.round(clamp01((rect.bottom - event.clientY) / rect.height) * 100) / 100)
    }
    release()
  }

  const style = { '--pill-ratio': ratio } as CSSProperties
  const content = (
    <>
      <span className={styles.value} data-visible={dragging || showValue || undefined}>{percent}</span>
      <span className={styles.icon}>{icon}</span>
    </>
  )

  return (
    <motion.div
      ref={rootRef}
      className={`${styles.pill} no-drag`}
      style={{ ...style, scaleX, scaleY, originY }}
      animate={{ scale: dragging && !reducedMotion ? 1.04 : 1 }}
      transition={{ type: 'spring', stiffness: 420, damping: 24 }}
      data-dragging={dragging || undefined}
      role="slider"
      aria-label="音量"
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-valuetext={`${percent}%`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={release}
      onLostPointerCapture={release}
    >
      <div className={styles.content}>{content}</div>
      <div className={styles.fill} aria-hidden="true">
        <div className={`${styles.content} ${styles.inverted}`}>{content}</div>
      </div>
    </motion.div>
  )
}
