import { useEffect } from 'react'
import { animate, motion, useMotionValue, useTransform } from 'motion/react'
import { useMotion } from '../../hooks/useMotion'
import { springCheckTransition, springCheckSwell } from '../../lib/motion-presets'
import styles from './SpringCheck.module.css'

interface SpringCheckProps {
  checked: boolean
  onChange(checked: boolean): void
  disabled?: boolean
  /** 半选：填充并显示横线，点击按 checked 处理。 */
  indeterminate?: boolean
  'aria-describedby'?: string
  'aria-label'?: string
}

/** 参考 React Bits Spring Check：同一弹簧驱动填充、勾线和回弹，输入仍由原生 checkbox 负责。 */
export function SpringCheck({ checked, onChange, disabled, indeterminate = false, ...rest }: SpringCheckProps) {
  const enabled = useMotion('toggleMotion')
  const progress = useMotionValue(checked ? 1 : 0)
  const fill = useTransform(progress, value => Math.max(0, value))
  const swell = useTransform(progress, value => 1 + springCheckSwell * Math.max(0, value - 1))
  const tick = useTransform(progress, value => 1 - Math.min(1, Math.max(0, value)))

  useEffect(() => {
    const target = checked || indeterminate ? 1 : 0
    if (!enabled) {
      progress.jump(target)
      return
    }
    if (progress.get() === target && progress.getVelocity() === 0) return
    const animation = animate(progress, target, springCheckTransition)
    return () => animation.stop()
  }, [checked, indeterminate, enabled, progress])

  return (
    <span className={styles.control} data-animate={enabled}>
      <input ref={element => { if (element) element.indeterminate = indeterminate && !checked }} className={styles.input} type="checkbox" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} {...rest} />
      <span className={styles.press} aria-hidden="true">
        <motion.span className={styles.box} style={{ scale: swell }}>
          <motion.span className={styles.fill} style={{ scale: fill }} />
          <svg className={styles.tick} viewBox="0 0 16 16">
            <motion.path d={indeterminate && !checked ? 'M4 8h8' : 'm3.5 8 3 3 6-6'} pathLength="1" strokeDasharray="1" style={{ strokeDashoffset: tick }} />
          </svg>
        </motion.span>
      </span>
    </span>
  )
}
