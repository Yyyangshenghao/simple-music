import { useState } from 'react'
import styles from './Switch.module.css'

interface SwitchProps {
  checked: boolean
  onChange(v: boolean): void
  disabled?: boolean
  'aria-label'?: string
  'aria-controls'?: string
  'aria-expanded'?: boolean
}

/** 胶囊滑动开关：圆点按压拉伸、过冲落位，切换时轨道外扩一圈涟漪。 */
export function Switch({ checked, onChange, disabled, ...rest }: SwitchProps) {
  // 只在用户点击后播放涟漪；用递增 key 让同一节点重新挂载以重播动画，首屏渲染不触发
  const [ripple, setRipple] = useState(0)
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={`${styles.track}${checked ? ` ${styles.on}` : ''} no-drag`}
      disabled={disabled}
      onClick={() => {
        setRipple((n) => n + 1)
        onChange(!checked)
      }}
      {...rest}
    >
      {ripple > 0 && <span key={ripple} className={styles.ripple} aria-hidden="true" />}
      <span className={styles.knob} aria-hidden="true" />
    </button>
  )
}
