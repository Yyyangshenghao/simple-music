import { Switch } from './Switch'
import styles from './Toggle.module.css'

interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: string
  disabled?: boolean
  className?: string
}

/** 带文字标签的开关，外观与动效复用 Switch。disabled 时变灰且不可点（用于 macOS 平台禁用项）。 */
export function Toggle({ checked, onChange, label, disabled, className }: ToggleProps) {
  return (
    <label
      className={`${styles.wrap} no-drag${disabled ? ` ${styles.disabled}` : ''}${className ? ` ${className}` : ''}`}
    >
      {label != null && <span className={styles.label}>{label}</span>}
      <Switch checked={checked} onChange={onChange} disabled={disabled} />
    </label>
  )
}
