import styles from './LyricOptionGroup.module.css'

export function LyricOptionGroup<T extends string | number>({ label, options, value, onChange }: {
  label: string
  options: readonly { value: T; label: string }[]
  value: T | undefined
  onChange(value: T): void
}) {
  return (
    <div className={styles.row}>
      <span>{label}{value === undefined && <small className={styles.custom}>自定义</small>}</span>
      <div className={styles.options} role="group" aria-label={label}>
        {options.map(option => <button key={option.value} type="button" aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}>{option.label}</button>)}
      </div>
    </div>
  )
}
