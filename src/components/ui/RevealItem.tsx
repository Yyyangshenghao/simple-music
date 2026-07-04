import { useRef } from 'react'
import type { ReactNode } from 'react'
import { motion, useInView } from 'motion/react'
import { fadeRise, springGentle } from '../../lib/motion-presets'

interface RevealItemProps {
  children: ReactNode
  /** 入场延迟（秒），用于 stagger。 */
  delay?: number
  className?: string
  /** 为 true 时跳过入场动画，直接可见——用于从详情返回等重挂载场景。 */
  disabled?: boolean
}

/** 进入视口时淡入上移一次（fadeRise + springGentle），配合 delay 做序列入场。 */
export function RevealItem({ children, delay = 0, className, disabled = false }: RevealItemProps) {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { amount: 0.1, once: true })

  return (
    <motion.div
      ref={ref}
      className={className}
      variants={fadeRise}
      initial={disabled ? false : 'hidden'}
      animate={disabled || inView ? 'visible' : 'hidden'}
      transition={{ ...springGentle, delay }}
    >
      {children}
    </motion.div>
  )
}
