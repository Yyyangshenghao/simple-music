import { useRef } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { motion, useMotionValue, useSpring, useTransform } from 'motion/react'
import { springGentle, gentleSpringValues } from '../../lib/motion-presets'
import styles from './TiltCard.module.css'

interface TiltCardProps {
  children: ReactNode
  className?: string
  /** 最大倾斜角（度），默认 8。 */
  maxTilt?: number
}

const REDUCED_MOTION =
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * 3D 倾斜追光卡片：鼠标位置驱动 rotateX/rotateY（弹簧平滑），
 * 卡片内光斑跟随光标（--spot-x/--spot-y），hover 上浮 + 氛围辉光。
 * reduced-motion 时不绑指针事件，仅保留辉光。
 */
export function TiltCard({ children, className, maxTilt = 8 }: TiltCardProps) {
  const ref = useRef<HTMLDivElement>(null)
  const px = useMotionValue(0.5)
  const py = useMotionValue(0.5)
  const sx = useSpring(px, gentleSpringValues)
  const sy = useSpring(py, gentleSpringValues)
  const rotateY = useTransform(sx, [0, 1], [-maxTilt, maxTilt])
  const rotateX = useTransform(sy, [0, 1], [maxTilt, -maxTilt])

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    px.set((e.clientX - rect.left) / rect.width)
    py.set((e.clientY - rect.top) / rect.height)
    // 光斑位置不走弹簧，直接跟手
    el.style.setProperty('--spot-x', `${e.clientX - rect.left}px`)
    el.style.setProperty('--spot-y', `${e.clientY - rect.top}px`)
  }

  function onPointerLeave() {
    px.set(0.5)
    py.set(0.5)
  }

  return (
    <motion.div
      ref={ref}
      className={`${styles.tilt} ${className ?? ''}`}
      style={{ rotateX, rotateY, transformPerspective: 800 }}
      whileHover={{ y: -4, scale: 1.02 }}
      whileTap={{ scale: 0.97 }}
      transition={springGentle}
      onPointerMove={REDUCED_MOTION ? undefined : onPointerMove}
      onPointerLeave={REDUCED_MOTION ? undefined : onPointerLeave}
    >
      {children}
      <div className={styles.spotlight} aria-hidden="true" />
    </motion.div>
  )
}
