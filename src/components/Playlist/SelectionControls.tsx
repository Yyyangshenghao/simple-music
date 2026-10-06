import { createPortal } from 'react-dom'
import type { SelectionRect } from '../../lib/multi-selection'
import styles from './SelectionControls.module.css'

export function SelectionToggle({ active, disabled, onClick, label = '多选' }: { active: boolean; disabled?: boolean; onClick(): void; label?: string }) {
  return <button type="button" className={styles.toggle} aria-pressed={active} disabled={disabled} onClick={onClick}>
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5" /><path d="m7 12 3 3 7-7" strokeLinecap="round" strokeLinejoin="round" /></svg>
    {label}
  </button>
}

export function SelectionCheck({ checked, disabled, label }: { checked: boolean; disabled?: boolean; label: string }) {
  return <button type="button" role="checkbox" aria-label={label} title={label} aria-checked={checked} disabled={disabled} className={styles.check}>
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path d="m4 10 4 4 8-8" strokeLinecap="round" strokeLinejoin="round" /></svg>
  </button>
}

export function SelectionMarquee({ rect }: { rect: SelectionRect | null }) {
  if (!rect || rect.right <= rect.left || rect.bottom <= rect.top) return null
  return createPortal(<div className={styles.marquee} aria-hidden="true" style={{ left: rect.left, top: rect.top, width: rect.right - rect.left, height: rect.bottom - rect.top }} />, document.body)
}
