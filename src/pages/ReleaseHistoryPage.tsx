import { useEffect, useRef } from 'react'
import { version as appVersion } from '../../package.json'
import { ReleaseHistory } from '../components/Update/ReleaseHistory'
import { useNavigationStore } from '../stores/navigation'
import { useUpdateStore } from '../stores/update'
import styles from './ReleaseHistoryPage.module.css'

export function ReleaseHistoryPage() {
  const currentVersion = useUpdateStore((state) => state.info?.currentVersion) || appVersion
  const goBack = useNavigationStore((state) => state.goBack)
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => { headingRef.current?.focus({ preventScroll: true }) }, [])

  return (
    <div className={styles.page}>
      <div className={styles.content}>
        <button type="button" className={`${styles.back} no-drag`} onClick={goBack}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path d="m15 5-7 7 7 7" />
          </svg>
          返回设置
        </button>
        <header className={styles.header}>
          <span className={styles.eyebrow}>SIMPLE MUSIC / RELEASE NOTES</span>
          <h1 ref={headingRef} tabIndex={-1}>更新日志</h1>
        </header>
        <ReleaseHistory currentVersion={currentVersion} />
      </div>
    </div>
  )
}
