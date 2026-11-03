import styles from './LibraryLink.module.css'

/** 前往某个库的入口：书架图标 + 库名 + 箭头，悬停时箭头前推。任务队列与伴奏面板共用，位置和样子一致。 */
export function LibraryLink({ label, ariaLabel, className, onClick }: { label: string; ariaLabel?: string; className?: string; onClick(): void }) {
  return <button type="button" className={`${styles.link}${className ? ` ${className}` : ''}`} aria-label={ariaLabel ?? `前往${label}`} onClick={onClick}>
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 4v16M8 4v16M12 6l5-2 4 14-5 2z" /></svg>
    <span>{label}</span>
    <svg className={styles.arrow} width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4" /></svg>
  </button>
}
