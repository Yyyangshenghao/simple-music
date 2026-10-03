import { useId } from 'react'
import styles from './InfoButton.module.css'

export function InfoButton({ label, text: description, align = 'right' }: { label: string; text: string; align?: 'left' | 'right' }) {
  const tooltipId = useId()
  return (
    <span className={styles.infoWrap} data-settings-info>
      <button
        type="button"
        className={styles.infoButton}
        aria-label={`${label}说明`}
        aria-describedby={tooltipId}
        onClick={(event) => event.currentTarget.focus()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') event.currentTarget.blur()
        }}
      >
        i
      </button>
      <span id={tooltipId} className={styles.infoTooltip} data-info-tooltip data-align={align} role="tooltip">{description}</span>
    </span>
  )
}
