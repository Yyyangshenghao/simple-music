import { useEffect, useRef, useState } from 'react'
import { animate, motion, useMotionValue, useSpring, useTransform, useVelocity } from 'motion/react'
import { switchFlowSpring, switchSlideSpring, switchSwell, switchSwellSpring } from '../../lib/motion-presets'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import styles from './Switch.module.css'

// 尺寸需参与弹簧与拖动计算，与 Switch.module.css 保持一致：轨道 44×24，滑块 18，内边距 3
const TRACK_W = 44
const INSET = 3
const THUMB = 18
const TRAVEL = TRACK_W - INSET * 2 - THUMB
/** 横移速度达到此值（px/s）时拉伸到最大。 */
const STRETCH_SPEED = 600
const MAX_STRETCH = 0.4
/** 按下后移动超过此距离才算拖动。 */
const DRAG_SLOP = 3

interface SwitchProps {
  checked: boolean
  onChange(v: boolean): void
  disabled?: boolean
  'aria-label'?: string
  'aria-controls'?: string
  'aria-expanded'?: boolean
}

/** 滑块位置与形变：值变化时弹簧滑到新位置，横移越快越横向拉长、纵向压扁（体积守恒），swell 控制悬停/按住时的鼓缩。 */
function useSquishThumb(checked: boolean, holding: boolean) {
  const reducedMotion = useReducedMotion()
  const x = useMotionValue(checked ? TRAVEL : 0)
  const flow = useSpring(useVelocity(x), switchFlowSpring)
  const swell = useSpring(1, switchSwellSpring)
  const stretchOf = (v: number) => 1 + (reducedMotion ? 0 : Math.min(MAX_STRETCH, Math.abs(v) / STRETCH_SPEED))
  const scaleX = useTransform(() => stretchOf(flow.get()) * swell.get())
  const scaleY = useTransform(() => swell.get() / stretchOf(flow.get()))

  useEffect(() => {
    if (holding) return
    const target = checked ? TRAVEL : 0
    if (reducedMotion) { x.jump(target); return }
    const controls = animate(x, target, { type: 'spring', ...switchSlideSpring })
    return () => controls.stop()
  }, [checked, holding, reducedMotion, x])

  return { x, swell, scaleX, scaleY, reducedMotion }
}

type Thumb = ReturnType<typeof useSquishThumb>

function Knob({ thumb }: { thumb: Thumb }) {
  return <motion.span className={styles.thumb} aria-hidden="true" style={{ x: thumb.x, scaleX: thumb.scaleX, scaleY: thumb.scaleY }} />
}

/**
 * 挤压开关（参考 React Bits SquishSwitch）：开态轨道与滑块反色；滑块按横移速度拉长压扁、落位回弹，
 * 悬停微鼓、按住压缩，支持拖动切换。减弱动态时直接落位、不形变。
 */
export function Switch({ checked, onChange, disabled, ...rest }: SwitchProps) {
  const [holding, setHolding] = useState(false)
  const thumb = useSquishThumb(checked, holding)
  const grip = useRef<{ pointer: number; startX: number; from: number; moved: boolean } | null>(null)
  const suppressClick = useRef(false)

  const release = (commit: boolean) => {
    const current = grip.current
    grip.current = null
    setHolding(false)
    thumb.swell.set(1)
    if (!current?.moved) return
    // 拖动松手：按滑块所在半边决定开关，并吞掉随后的 click
    suppressClick.current = true
    const next = thumb.x.get() > TRAVEL / 2
    if (commit && next !== checked) onChange(next)
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={`${styles.track}${checked ? ` ${styles.on}` : ''} no-drag`}
      disabled={disabled}
      onPointerEnter={(event) => { if (event.pointerType === 'mouse' && !disabled && !grip.current) thumb.swell.set(switchSwell.hover) }}
      onPointerLeave={() => { if (!grip.current) thumb.swell.set(1) }}
      onPointerDown={(event) => {
        if (event.button !== 0 || disabled) return
        suppressClick.current = false
        grip.current = { pointer: event.pointerId, startX: event.clientX, from: thumb.x.get(), moved: false }
        event.currentTarget.setPointerCapture(event.pointerId)
        if (!thumb.reducedMotion) thumb.swell.set(switchSwell.press)
      }}
      onPointerMove={(event) => {
        const current = grip.current
        if (!current || current.pointer !== event.pointerId) return
        const dx = event.clientX - current.startX
        if (!current.moved && Math.abs(dx) < DRAG_SLOP) return
        if (!current.moved) { current.moved = true; setHolding(true) }
        thumb.x.set(Math.min(Math.max(current.from + dx, 0), TRAVEL))
      }}
      onPointerUp={(event) => {
        if (grip.current?.pointer !== event.pointerId) return
        release(true)
        if (event.pointerType === 'mouse') thumb.swell.set(switchSwell.hover)
      }}
      onPointerCancel={() => release(false)}
      onLostPointerCapture={() => { if (grip.current) release(false) }}
      onClick={() => {
        if (suppressClick.current) { suppressClick.current = false; return }
        onChange(!checked)
      }}
      {...rest}
    >
      <Knob thumb={thumb} />
    </button>
  )
}

/** 只展示不响应输入的开关外观，用于整行可点击、行本身承担 role="switch" 的场景。 */
export function SwitchIndicator({ checked }: { checked: boolean }) {
  const thumb = useSquishThumb(checked, false)
  return (
    <span className={`${styles.track}${checked ? ` ${styles.on}` : ''}`} aria-hidden="true">
      <Knob thumb={thumb} />
    </span>
  )
}
