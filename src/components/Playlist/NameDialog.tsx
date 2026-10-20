import { useEffect, useId, useRef, type ReactNode } from 'react'
import styles from './NameDialog.module.css'

export { styles as nameDialogStyles }

/** 歌单类弹窗的极简外壳（新建、重命名、加入）：标题、可选徽标与一行上下文；Esc、点遮罩或「取消」关闭。 */
export function NameDialog({ title, badge, subtitle, className = '', onClose, children }: { title: string; badge?: ReactNode; subtitle?: ReactNode; className?: string; onClose(): void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const dialog = ref.current
    dialog?.showModal()
    dialog?.querySelector<HTMLInputElement>('input:not(:disabled)')?.focus()
    return () => dialog?.close()
  }, [])
  return <dialog ref={ref} className={`${styles.dialog} ${className} no-drag`} aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); onClose() }} onKeyDown={event => event.stopPropagation()}
    onMouseDown={event => {
      // 内边距同样以 dialog 自身为 target，需按矩形判断是否真的点在遮罩上。
      if (event.target !== event.currentTarget) return
      const rect = event.currentTarget.getBoundingClientRect()
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose()
    }}>
    <div className={styles.header}><h2 id={titleId}>{title}</h2>{badge}</div>
    {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
    {children}
  </dialog>
}

export const PLUS_ICON = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
export const CHECK_ICON = <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
export const SEARCH_ICON = <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></svg>
export const LOCK_ICON = <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2.5" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
