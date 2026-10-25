import { useId, type ReactNode } from 'react'
import { RevealText } from './RevealText'
import styles from './InfoButton.module.css'

function positionTooltip(anchor: HTMLSpanElement): void {
  const tooltip = anchor.querySelector<HTMLSpanElement>('[data-info-tooltip]')
  if (!tooltip) return
  const bounds = anchor.getBoundingClientRect()
  const height = tooltip.offsetHeight
  const margin = 12
  const style = getComputedStyle(anchor)
  const section = anchor.closest<HTMLElement>('[id^="settings-detail-"]')
  const topInset = Math.max(
    parseFloat(style.getPropertyValue('--sm-topbar-height')) || 0,
    section ? parseFloat(getComputedStyle(section).scrollMarginTop) || 0 : 0
  )
  const minTop = topInset + margin
  const maxBottom = window.innerHeight - (parseFloat(style.getPropertyValue('--sm-player-clearance')) || 0) - margin
  let top = bounds.bottom + 8
  if (top + height > maxBottom) top = bounds.top - height - 8
  top = Math.max(minTop, Math.min(top, maxBottom - height))
  tooltip.style.top = `${top - bounds.top}px`
}

export function InfoButton({ label, text: description, align = 'right', preview }: { label: string; text: string; align?: 'left' | 'right'; preview?: ReactNode }) {
  const tooltipId = useId()
  return (
    <span className={styles.infoWrap} data-settings-info onMouseEnter={event => positionTooltip(event.currentTarget)}>
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
