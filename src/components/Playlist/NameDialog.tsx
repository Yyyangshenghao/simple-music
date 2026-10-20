import { useEffect, useId, useRef, type ReactNode } from 'react'
import styles from './NameDialog.module.css'

export { styles as nameDialogStyles }

/** 新建/重命名歌单的极简弹窗外壳：只有标题、可选徽标与内容；Esc 或「取消」关闭。 */
export function NameDialog({ title, badge, onClose, children }: { title: string; badge?: ReactNode; onClose(): void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const dialog = ref.current
    dialog?.showModal()
    dialog?.querySelector<HTMLInputElement>('input:not(:disabled)')?.focus()
    return () => dialog?.close()
  }, [])
  return <dialog ref={ref} className={`${styles.dialog} no-drag`} aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); onClose() }} onKeyDown={event => event.stopPropagation()}
    onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <div className={styles.header}><h2 id={titleId}>{title}</h2>{badge}</div>
    {children}
  </dialog>
}

export const LOCK_ICON = <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2.5" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
