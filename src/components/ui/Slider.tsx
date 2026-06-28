import styles from './Slider.module.css'

interface SliderProps {
  value: number
  min?: number
  max?: number
  step?: number
  label?: string
  onChange: (value: number) => void
  className?: string
}

/** 受控滑块。range input 包一层标签与数值显示。 */
export function Slider({ value, min = 0, max = 1, step = 0.01, label, onChange, className }: SliderProps) {
  return (
    <label className={`${styles.wrap} no-drag${className ? ` ${className}` : ''}`}>
      {label != null && (
        <span className={styles.head}>
          <span className={styles.label}>{label}</span>
          <span className={styles.value}>{value}</span>
        </span>
      )}
      <input
        className={styles.range}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  )
}
