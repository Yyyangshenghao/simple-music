import { motion } from 'motion/react'
import { springSnappy } from '../../lib/motion-presets'
import styles from './Switch.module.css'

interface SwitchProps {
  checked: boolean
  onChange(v: boolean): void
  disabled?: boolean
  'aria-label'?: string
}

/** 胶囊滑动开关：轨道随开关态变强调色，圆点弹簧滑动。 */
export function Switch({ checked, onChange, disabled, ...rest }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={`${styles.track}${checked ? ` ${styles.on}` : ''} no-drag`}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      {...rest}
    >
      <motion.span className={styles.thumb} layout transition={springSnappy} />
    </button>
  )
}
