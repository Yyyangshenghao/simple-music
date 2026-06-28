import styles from './Toggle.module.css'

interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: string
  disabled?: boolean
  className?: string
}

/** 开关。disabled 时变灰且不可点（用于 macOS 平台禁用项）。 */
export function Toggle({ checked, onChange, label, disabled, className }: ToggleProps) {
  return (
    <label
      className={`${styles.wrap} no-drag${disabled ? ` ${styles.disabled}` : ''}${className ? ` ${className}` : ''}`}
    >
      {label != null && <span className={styles.label}>{label}</span>}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        className={`${styles.track}${checked ? ` ${styles.on}` : ''}`}
        onClick={() => !disabled && onChange(!checked)}
      >
        <span className={styles.thumb} />
      </button>
    </label>
  )
}
