import { useEffect, useRef } from 'react'
import { motion, useMotionValue, useSpring, useTransform, useVelocity } from 'motion/react'
import { liquidLiftSpring, liquidPillSpring } from '../../lib/motion-presets'
import { ensureCapsuleRefraction } from '../../lib/liquid-glass-filter'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import styles from './Switch.module.css'

// 尺寸需参与弹簧与拖动计算，与 Switch.module.css 的 --sw-* 保持一致
const TRACK_W = 46
const PAD = 2
const THUMB_W = 28
const THUMB_H = 20
const TRAVEL = TRACK_W - PAD * 2 - THUMB_W
/** 点击切换时透镜浮起的时长，覆盖弹簧横移与落位回弹。 */
const TRANSIT_LIFT_MS = 240
/** 位移贴图按圆点未缩放尺寸生成，浮起放大后折射量随之放大。 */
const REFRACTION_ID = 'sm-switch-refraction'

interface SwitchProps {
  checked: boolean
  onChange(v: boolean): void
  disabled?: boolean
  'aria-label'?: string
  'aria-controls'?: string
  'aria-expanded'?: boolean
}

/** 圆点位置、浮起程度与形变：横移越快越拉长变扁，浮起时放大成溢出轨道的透镜。 */
function useLiquidThumb(checked: boolean) {
  const reducedMotion = useReducedMotion()
  const target = useMotionValue(checked ? TRAVEL : 0)
  const liftTarget = useMotionValue(0)
  const x = useSpring(target, liquidPillSpring)
  const lift = useSpring(liftTarget, liquidLiftSpring)
  const velocity = useVelocity(x)
  const stretch = useTransform(velocity, v => reducedMotion ? 0 : Math.min(Math.abs(v) / 650, 0.32))
  const scaleX = useTransform(() => Math.min(1 + stretch.get() + lift.get() * 0.5, 1.6))
  const scaleY = useTransform(() => 1 - stretch.get() * 0.4 + lift.get() * 0.55)
  const progress = useTransform(x, v => Math.min(Math.max(v / TRAVEL, 0), 1))
  // 开态底色铺到圆点（含浮起放大后）的右缘，拖动时跟着圆点推进，透镜里不会露出底色断口
  const fillClip = useTransform(() => {
    const right = x.get() + PAD + THUMB_W / 2 + (THUMB_W / 2) * scaleX.get()
    return `inset(0 ${Math.max(TRACK_W - right, 0)}px 0 0 round 999px)`
  })
  const solidOpacity = useTransform(lift, l => 1 - Math.min(l * 1.6, 1))
  const transitTimer = useRef<number>()

  function settleLift(delay: number) {
    window.clearTimeout(transitTimer.current)
    transitTimer.current = window.setTimeout(() => liftTarget.set(0), delay)
  }
  function moveTo(on: boolean) {
    target.set(on ? TRAVEL : 0)
    if (reducedMotion) x.jump(on ? TRAVEL : 0)
  }
  function lifted(on: boolean) {
    window.clearTimeout(transitTimer.current)
    liftTarget.set(on && !reducedMotion ? 1 : 0)
    if (reducedMotion) lift.jump(0)
  }

  useEffect(() => () => window.clearTimeout(transitTimer.current), [])
  // 减弱动态打开时透镜不渲染，浮起值必须立即归零，否则实心圆点会一直隐藏
  useEffect(() => {
    if (!reducedMotion) return
    window.clearTimeout(transitTimer.current)
    liftTarget.set(0)
    lift.jump(0)
  }, [reducedMotion])
  useEffect(() => { ensureCapsuleRefraction(REFRACTION_ID, THUMB_W, THUMB_H, 6) }, [])

  return { target, x, lift, scaleX, scaleY, progress, fillClip, solidOpacity, reducedMotion, settleLift, moveTo, lifted }
}

type Thumb = ReturnType<typeof useLiquidThumb>

/** 值从外部变化（点击、键盘、程序设置）时滑到新位置，途中短暂浮起成透镜。 */
function useFollowChecked(thumb: Thumb, checked: boolean, gestureActive: () => boolean) {
  const last = useRef(checked)
  useEffect(() => {
    if (last.current === checked) return
    last.current = checked
    if (gestureActive()) return
    thumb.moveTo(checked)
    if (thumb.reducedMotion) return
    thumb.lifted(true)
    thumb.settleLift(TRANSIT_LIFT_MS)
  }, [checked])
}

function SwitchBody({ thumb }: { thumb: Thumb }) {
  return <>
    <motion.span className={styles.fill} aria-hidden="true" style={{ opacity: thumb.progress, clipPath: thumb.fillClip }} />
    <motion.span className={styles.thumb} aria-hidden="true" style={{ x: thumb.x, scaleX: thumb.scaleX, scaleY: thumb.scaleY }}>
      <motion.span className={styles.solid} style={{ opacity: thumb.solidOpacity }} />
      {!thumb.reducedMotion && <motion.span className={styles.lens} style={{ opacity: thumb.lift }} />}
    </motion.span>
  </>
}

/**
 * 流体玻璃开关（参照 iOS 液态玻璃）：静止时是实心胶囊圆点；按住、拖动或切换途中浮起放大成透镜，
 * 透过它能看到轨道被折射弯曲。圆点按速度拉伸、落位过冲回弹，开态底色随圆点推进。
 */
export function Switch({ checked, onChange, disabled, ...rest }: SwitchProps) {
  const thumb = useLiquidThumb(checked)
  const gesture = useRef<{ pointer: number; startX: number; from: number; moved: boolean } | null>(null)
  const suppressClick = useRef(false)
  useFollowChecked(thumb, checked, () => gesture.current !== null)

  function cancelGesture() {
    gesture.current = null
    thumb.moveTo(checked)
    thumb.settleLift(0)
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={`${styles.track}${checked ? ` ${styles.on}` : ''} no-drag`}
      disabled={disabled}
      onPointerDown={event => {
        if (event.button !== 0 || disabled) return
        suppressClick.current = false
        gesture.current = { pointer: event.pointerId, startX: event.clientX, from: thumb.target.get(), moved: false }
        event.currentTarget.setPointerCapture(event.pointerId)
        thumb.lifted(true)
      }}
      onPointerMove={event => {
        const current = gesture.current
        if (!current || current.pointer !== event.pointerId) return
        const dx = event.clientX - current.startX
        if (!current.moved && Math.abs(dx) < 3) return
        current.moved = true
        thumb.target.set(Math.min(Math.max(current.from + dx, 0), TRAVEL))
      }}
      onPointerUp={event => {
        const current = gesture.current
        if (!current || current.pointer !== event.pointerId) return
        gesture.current = null
        if (current.moved) {
          // 拖动松手：按圆点所在半边决定开关，不再触发随后的 click
          suppressClick.current = true
          const next = thumb.target.get() > TRAVEL / 2
          thumb.moveTo(next)
          thumb.settleLift(TRANSIT_LIFT_MS * 0.6)
          if (next !== checked) onChange(next)
        } else {
          // 普通点击：位置交给 click → onChange → useFollowChecked，父组件拒绝变更时圆点不会错位
          thumb.settleLift(TRANSIT_LIFT_MS)
        }
      }}
      onPointerCancel={cancelGesture}
      onLostPointerCapture={() => { if (gesture.current) cancelGesture() }}
      onClick={() => {
        if (suppressClick.current) { suppressClick.current = false; return }
        onChange(!checked)
      }}
      {...rest}
    >
      <SwitchBody thumb={thumb} />
    </button>
  )
}

/** 只展示不响应输入的开关外观，用于整行可点击、行本身承担 role="switch" 的场景。 */
export function SwitchIndicator({ checked }: { checked: boolean }) {
  const thumb = useLiquidThumb(checked)
  useFollowChecked(thumb, checked, () => false)
  return (
    <span className={`${styles.track}${checked ? ` ${styles.on}` : ''}`} aria-hidden="true">
      <SwitchBody thumb={thumb} />
    </span>
  )
}
