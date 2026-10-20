import { useEffect, useRef } from 'react'
import { version as appVersion } from '../../package.json'
import { ReleaseHistory } from '../components/Update/ReleaseHistory'
import { useNavigationStore } from '../stores/navigation'
import { useUpdateStore } from '../stores/update'
import styles from './ReleaseHistoryPage.module.css'
import pageScroll from '../styles/page-scroll.module.css'
import { BackButton } from '../components/ui/BackButton'

export function ReleaseHistoryPage() {
  const currentVersion = useUpdateStore((state) => state.info?.currentVersion) || appVersion
  const goBack = useNavigationStore((state) => state.goBack)
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => { headingRef.current?.focus({ preventScroll: true }) }, [])

  return (
    <div className={`${styles.page} ${pageScroll.viewport}`}>
      <div className={styles.content}>
        <BackButton onClick={() => goBack()} label="返回设置" />
        <header className={styles.header}>
          <span className={styles.eyebrow}>SIMPLE MUSIC / RELEASE NOTES</span>
          <h1 ref={headingRef} tabIndex={-1}>更新日志</h1>
        </header>
        <ReleaseHistory currentVersion={currentVersion} />
      </div>
    </div>
  )
}
