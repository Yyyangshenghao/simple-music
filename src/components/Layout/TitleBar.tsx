import { useNavigationStore } from '../../stores/navigation'
import type { AppView } from '../../stores/navigation'
import { SearchPill } from './SearchPill'
import { SourceSwitcher } from './SourceSwitcher'
import styles from './TitleBar.module.css'

const TABS: { view: AppView; label: string }[] = [
  { view: 'explore', label: '探索' },
  { view: 'library', label: '我的库' },
  { view: 'settings', label: '设置' },
]

export function TitleBar() {
  const currentView = useNavigationStore((s) => s.currentView)
  const navigateTo = useNavigationStore((s) => s.navigateTo)

  const activeTab = typeof currentView === 'string' ? currentView : null

  return (
    <header className={`${styles.bar} desktop-shell`}>
      {/* 左侧：traffic lights 占位 + 搜索 */}
      <div className={styles.left}>
        <div className={styles.trafficLights} aria-hidden="true" />
        <SearchPill />
      </div>

      {/* 中间：标签导航（绝对居中） */}
      <nav className={styles.tabs} aria-label="主导航">
        {TABS.map(({ view, label }) => (
          <button
            key={String(view)}
            className={`${styles.tab} no-drag ${activeTab === view ? styles.active : ''}`}
            onClick={() => navigateTo(view)}
          >
            {label}
          </button>
        ))}
      </nav>

      {/* 右侧：音源切换 + 头像 */}
      <div className={styles.right}>
        <SourceSwitcher />
        <button className={`${styles.avatar} no-drag`} aria-label="账户">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 12c2.7 0 5-2.3 5-5s-2.3-5-5-5-5 2.3-5 5 2.3 5 5 5zm0 2c-3.3 0-10 1.7-10 5v1h20v-1c0-3.3-6.7-5-10-5z"/>
          </svg>
        </button>
      </div>
    </header>
  )
}
