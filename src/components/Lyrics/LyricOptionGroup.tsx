import type { CSSProperties } from 'react'
import { useMotion } from '../../hooks/useMotion'
import styles from './LyricOptionGroup.module.css'

/** 浅槽分段控件：选中项只抬一层底，滑块在槽里平移过去；值不在预设里时标「自定义」、不显示滑块。 */
export function LyricOptionGroup<T extends string | number>({ label, options, value, onChange }: {
  label: string
  options: readonly { value: T; label: string }[]
  value: T | undefined
  onChange(value: T): void
}) {
  const animate = useMotion('indicatorMotion')
  const index = options.findIndex(option => option.value === value)
  return (
    <div className={styles.row}>
      <span>{label}{value === undefined && <small className={styles.custom}>自定义</small>}</span>
      <div className={styles.options} role="group" aria-label={label} data-animate={animate}
        style={{ '--count': options.length, '--index': Math.max(0, index) } as CSSProperties}>
        {index >= 0 && <span className={styles.thumb} aria-hidden="true" />}
        {options.map(option => <button key={option.value} type="button" aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}>{option.label}</button>)}
      </div>
    </div>
  )
}
