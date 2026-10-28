import type { ButtonHTMLAttributes } from 'react'
import { ActionIcon, type ActionIconName } from './ActionIcon'
import styles from './ActionButton.module.css'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  'data-tip'?: string
  icon?: ActionIconName
  iconOnly?: boolean
  primary?: boolean
  busy?: boolean
  danger?: boolean
  compact?: boolean
}

export function ActionButton({ label, icon, iconOnly, primary, busy, danger, compact, className = '', children, disabled, title, 'data-tip': tip, ...props }: Props) {
  return <button {...props} type="button" className={`${styles.button} ${className} no-drag`} data-icon-action={iconOnly || undefined}
    data-tip-help={!!title && title !== label || undefined} data-primary={primary || undefined} data-danger={danger || undefined} data-compact={compact || undefined}
    aria-label={props['aria-label'] ?? label} data-tip={tip ?? title ?? label} disabled={disabled || busy} aria-busy={busy || undefined}>
    <span className={styles.content}>{icon && <ActionIcon name={icon} />}{!iconOnly && (children ?? label)}</span>
    {busy && <svg className={styles.spinner} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M12 3a9 9 0 1 1-9 9" /></svg>}
  </button>
}
