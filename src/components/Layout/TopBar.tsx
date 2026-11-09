import { useState } from 'react'
import { motion } from 'motion/react'
import { useNavigationStore, type AppView } from '../../stores/navigation'
import { AvatarMenu } from './AvatarMenu'
import { SourceAvatar } from '../ui/SourceAvatar'
import { TaskBubble } from './TaskBubble'
import { PROVIDER_IDS } from '../../providers/types'
import { useProviderStore } from '../../stores/providers'
import { useSettingsStore } from '../../stores/settings'
import { TOP_MENU_ITEMS, type TopMenuId } from '../../lib/top-menu'
import { useContentProvider } from '../../hooks/useContentProvider'
import { springSnappy, tapScale } from '../../lib/motion-presets'
import { drawsCaptionButtons } from './caption-buttons'
import styles from './TopBar.module.css'
import { useFeedback, useMotion } from '../../hooks/useMotion'

function sectionOf(view: AppView, history: AppView[]): TopMenuId {
  if (typeof view === 'string') return view === 'release-history' ? 'settings' : view
  if (view.type === 'search' || view.type === 'bilibili-video') return 'search'
  if (view.type === 'app-playlist' || (view.type === 'playlist' && view.from === 'library')) return 'library'
  if (view.type === 'toplist' || view.type === 'provider-playlists') return 'explore'
  const origin = history.at(-1)
  return origin && sectionOf(origin, history.slice(0, -1)) === 'search' ? 'search' : 'explore'
}

interface TopBarProps {
  /** 歌词面板打开时隐藏顶栏 */
  hidden?: boolean
}

export function TopBar({ hidden = false }: TopBarProps) {
  const tap = useFeedback('tapFeedbackMotion')
  const controlMotion = useMotion('indicatorMotion')
  const { current: contentSource } = useContentProvider()
  const currentView = useNavigationStore((s) => s.currentView)
  const history = useNavigationStore((s) => s.history)
  const future = useNavigationStore((s) => s.future)
  const navigateTo = useNavigationStore((s) => s.navigateTo)
  const goBack = useNavigationStore((s) => s.goBack)
  const goForward = useNavigationStore((s) => s.goForward)

  const openSearch = useNavigationStore((s) => s.openSearch)
  const section = sectionOf(currentView, history)
  const menu = useSettingsStore(state => state.topMenu).filter(item => item.enabled)
  const [avatarMenuOpen, setAvatarMenuOpen] = useState(false)
  // 每次点击递增，作为 key 重挂箭头外壳以重播穿滑动画
  const [navPulse, setNavPulse] = useState({ back: 0, forward: 0 })

  // 未登录或游客平台没有头像时显示通用图标和平台角标。
  const contentAvatar = useProviderStore((state) => contentSource ? state.byId[contentSource].profile?.avatar ?? '' : '')
  const enabledCount = useProviderStore((state) =>
    PROVIDER_IDS.filter((source) => state.byId[source].enabled && state.byId[source].auth === 'authenticated').length
  )

  const platform = window.desktop?.platform
  const isMac = platform === 'darwin'
  const isWindows = platform === 'win32'
  // Windows 与 Linux 的窗口按钮都由 WindowChrome 自绘，两者都要在顶栏右侧留出占位，
  // 否则最右边的关闭按钮会压在头像上。
  const hasCaptionButtons = drawsCaptionButtons(platform)

  return (
    <div
      className={`${styles.bar}${hidden ? ` ${styles.barHidden}` : ''}${isMac ? ` ${styles.barMac}` : ''}${hasCaptionButtons ? ` ${styles.barCaption}` : ''}`}
      onDoubleClick={(e) => {
        if (isWindows && e.target === e.currentTarget) void window.desktop.maximize()
      }}
    >
      {/* Left: traffic lights 留白 + 后退/前进按钮 */}
      <div className={styles.left}>
        <div className={styles.navGroup}>
          <button
            className={styles.navBtn}
            data-dir="back"
            onClick={() => { setNavPulse((p) => ({ ...p, back: p.back + 1 })); goBack() }}
            disabled={history.length === 0}
            aria-label="后退"
          >
            <span key={navPulse.back} className={`${styles.navArrow}${navPulse.back > 0 ? ` ${styles.navArrowGo}` : ''}`} aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </span>
          </button>
          <button
            className={styles.navBtn}
            data-dir="forward"
            onClick={() => { setNavPulse((p) => ({ ...p, forward: p.forward + 1 })); goForward() }}
            disabled={future.length === 0}
            aria-label="前进"
          >
            <span key={navPulse.forward} className={`${styles.navArrow}${navPulse.forward > 0 ? ` ${styles.navArrowGo}` : ''}`} aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 6l6 6-6 6" />
              </svg>
            </span>
          </button>
        </div>
      </div>

      {/* Center: 滑动胶囊导航（绝对居中） */}
      {menu.length > 0 && <div className={styles.center}>
        <nav className={styles.segNav} aria-label="主导航">
          {menu.map(({ id }) => {
            const active = section === id
            return (
              <button
                key={id}
                className={`${styles.segItem}${active ? ` ${styles.segActive}` : ''}`}
                onClick={() => {
                  if (id === 'search') openSearch()
                  else if (currentView !== id) navigateTo(id)
                }}
                aria-current={active ? 'page' : undefined}
              >
                {active && (
                  <motion.span
                    layoutId="topbar-seg-pill"
                    className={styles.segPill}
                    transition={controlMotion ? springSnappy : { duration: 0 }}
                  />
                )}
                <span className={styles.segLabel}>{TOP_MENU_ITEMS[id]}</span>
              </button>
            )
          })}
        </nav>
      </div>}

      <div className={styles.right}>
        <TaskBubble>
        <div className={styles.avatarWrap}>
          <motion.button
            className={styles.avatarBtn}
            onClick={() => setAvatarMenuOpen((v) => !v)}
            aria-label={`音源与账号，已启用 ${enabledCount} 个平台`}
            whileTap={tap(tapScale)}
            transition={springSnappy}
          >
            <span className={styles.avatarInner}>
              {contentSource ? <SourceAvatar source={contentSource} avatarUrl={contentAvatar} /> : <svg className={styles.accountGlyph} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <circle cx="12" cy="8" r="4" />
                <path d="M4.5 20.5c1.6-3.4 4.3-5 7.5-5s5.9 1.6 7.5 5" />
              </svg>}
            </span>
          </motion.button>
          {avatarMenuOpen && (
            <AvatarMenu onClose={() => setAvatarMenuOpen(false)} />
          )}
        </div>
        </TaskBubble>
      </div>
    </div>
  )
}
