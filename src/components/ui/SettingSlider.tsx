import { useRef, useState } from 'react'
import { ScrubSlider } from './ScrubSlider'
import styles from './SettingSlider.module.css'

interface SettingSliderProps {
  value: number
  min: number
  max: number
  step: number
  /** 双击滑条恢复的默认值。 */
  defaultValue: number
  onChange(value: number): void
  /** 当前值的展示文字（含单位）。 */
  format(value: number): string
  /** 点开数值输入时的换算：显示值 = 值 × scale，如百分比传 100。 */
  scale?: number
  /** 输入框后的单位。 */
  unit?: string
  ariaLabel: string
  disabled?: boolean
}

/**
 * 设置页滑条：沿用播放栏的胶囊滑条，右侧数值可点开直接输入（回车确认、Esc 取消），双击滑条恢复默认。
 */
export function SettingSlider({ value, min, max, step, defaultValue, onChange, format, scale = 1, unit = '', ariaLabel, disabled }: SettingSliderProps) {
  const [draft, setDraft] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const decimals = Math.max(0, Math.ceil(-Math.log10(step * scale) - 1e-9))

  const startEdit = () => {
    if (disabled) return
    setDraft((value * scale).toFixed(decimals))
    requestAnimationFrame(() => inputRef.current?.select())
  }
  const finishEdit = (commit: boolean) => {
    if (draft === null) return
    const typed = parseFloat(draft.replace(/[^\d.-]/g, ''))
    setDraft(null)
    if (!commit || Number.isNaN(typed)) return
    const stepped = min + Math.round((typed / scale - min) / step) * step
    const next = Math.min(max, Math.max(min, Number(stepped.toFixed(10))))
    if (next !== value) onChange(next)
  }

  return (
    <div className={styles.root} data-disabled={disabled || undefined}>
      <div
        className={styles.slider}
        title="双击恢复默认"
        onDoubleClick={() => { if (!disabled && value !== defaultValue) onChange(defaultValue) }}
      >
        <ScrubSlider
          variant="capsule"
          ariaLabel={ariaLabel}
          ariaValueText={format}
          value={value}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          onChange={onChange}
        />
      </div>
      {draft === null ? (
        <button type="button" className={`${styles.value} no-drag`} disabled={disabled}
          aria-label={`${ariaLabel}：${format(value)}，点击输入`} onClick={startEdit}>
          {format(value)}
        </button>
      ) : (
        <span className={styles.editor}>
          <input
            ref={inputRef}
            className={styles.input}
            type="text"
            inputMode="decimal"
            aria-label={`${ariaLabel}数值`}
            value={draft}
            autoFocus
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => finishEdit(true)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') { event.preventDefault(); finishEdit(true) }
              else if (event.key === 'Escape') { event.preventDefault(); finishEdit(false) }
            }}
          />
          {unit && <span className={styles.unit}>{unit}</span>}
        </span>
      )}
    </div>
  )
}
