import { useEffect, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { motion, useMotionValue, useSpring, useTransform } from 'motion/react'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import { springGentle, gentleSpringValues } from '../../lib/motion-presets'
import { useSettingsStore } from '../../stores/settings'
import styles from './TiltCard.module.css'

interface TiltCardProps {
  children: ReactNode
  className?: string
  /** 最大倾斜角（度），默认 8。 */
  maxTilt?: number
  disabled?: boolean
}

/**
 * 3D 倾斜追光卡片：鼠标位置驱动 rotateX/rotateY（弹簧平滑），
 * 卡片内光斑跟随光标（--spot-x/--spot-y），hover 上浮 + 氛围辉光。
 * 倾斜与光斑分别控制；系统减少动态时暂停跟随和位移反馈。
 */
export function TiltCard({ children, className, maxTilt = 8, disabled = false }: TiltCardProps) {
  const ref = useRef<HTMLDivElement>(null)
  const px = useMotionValue(0.5)
  const py = useMotionValue(0.5)
  const sx = useSpring(px, gentleSpringValues)
  const sy = useSpring(py, gentleSpringValues)
  const rotateY = useTransform(sx, [0, 1], [-maxTilt, maxTilt])
  const rotateX = useTransform(sy, [0, 1], [maxTilt, -maxTilt])
  const systemReducedMotion = useReducedMotion()
  const cardTiltEffect = useSettingsStore((s) => s.performance.cardTiltEffect)
  const cardSpotlightEffect = useSettingsStore((s) => s.performance.cardSpotlightEffect)
  const reducedMotion = disabled || systemReducedMotion
  const tiltEnabled = cardTiltEffect && !reducedMotion
  const spotlightEnabled = cardSpotlightEffect && !reducedMotion

  // 独立复位已关闭的效果，避免姿态或光斑坐标残留。
  useEffect(() => {
    if (!tiltEnabled) {
      px.set(0.5)
      py.set(0.5)
    }
    if (!spotlightEnabled) {
      ref.current?.style.removeProperty('--spot-x')
      ref.current?.style.removeProperty('--spot-y')
    }
  }, [tiltEnabled, spotlightEnabled, px, py])

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (tiltEnabled) {
      px.set((e.clientX - rect.left) / rect.width)
      py.set((e.clientY - rect.top) / rect.height)
    }
    // 光斑位置不走弹簧，直接跟手
    if (spotlightEnabled) {
      el.style.setProperty('--spot-x', `${e.clientX - rect.left}px`)
      el.style.setProperty('--spot-y', `${e.clientY - rect.top}px`)
    }
  }

  function onPointerLeave() {
    px.set(0.5)
    py.set(0.5)
  }

  return (
    <motion.div
      ref={ref}
      className={`${styles.tilt} ${className ?? ''}`}
      style={{ rotateX: tiltEnabled ? rotateX : 0, rotateY: tiltEnabled ? rotateY : 0, transformPerspective: 800 }}
      whileHover={reducedMotion ? undefined : { y: -4, scale: 1.02 }}
      whileTap={reducedMotion ? undefined : { scale: 0.97 }}
      transition={springGentle}
      onPointerMove={tiltEnabled || spotlightEnabled ? onPointerMove : undefined}
      onPointerLeave={tiltEnabled ? onPointerLeave : undefined}
    >
      {children}
      {spotlightEnabled && <div className={styles.spotlight} aria-hidden="true" />}
    </motion.div>
  )
}
