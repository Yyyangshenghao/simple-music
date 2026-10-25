import { useId, type ReactNode } from 'react'
import { RevealText } from './RevealText'
import styles from './InfoButton.module.css'

export function InfoButton({ label, text: description, align = 'right', preview }: { label: string; text: string; align?: 'left' | 'right'; preview?: ReactNode }) {
  const tooltipId = useId()
  return (
    <span className={styles.infoWrap} data-settings-info>
      <button
        type="button"
        className={styles.infoButton}
        aria-label={`${label}说明`}
        aria-describedby={tooltipId}
      >
        i
      </button>
      <span id={tooltipId} className={styles.infoTooltip} data-info-tooltip data-align={align} role="tooltip">{preview}<RevealText text={description} /></span>
    </span>
  )
}
