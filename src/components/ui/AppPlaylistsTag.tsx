import styles from './AppPlaylistsTag.module.css'

/** 应用歌单的身份标识，与平台来源徽标同形。 */
export function AppPlaylistsTag() {
  return <span className={styles.tag}>
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9z" /><path d="M18 15l.8 1.9 1.9.8-1.9.8L18 20.4l-.8-1.9-1.9-.8 1.9-.8z" /></svg>
    应用歌单
  </span>
}
