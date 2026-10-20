import styles from './LockGlyph.module.css'

/** 挂锁图标：open 时锁梁绕右脚抬起、左脚翻出锁体，用于私有/公开切换。 */
export function LockGlyph({ open, size = 18 }: { open: boolean; size?: number }) {
  return <svg className={styles.glyph} data-open={open} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path className={styles.shackle} d="M8 11V8a4 4 0 0 1 8 0v3" /><rect x="5" y="11" width="14" height="10" rx="2.5" /><path d="M12 15.2v2" />
  </svg>
}
