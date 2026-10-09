import { lazy, Suspense, useState } from 'react'
import { AnimatePresence, LayoutGroup, motion } from 'motion/react'
import type { Variants } from 'motion/react'
import { pageTransition } from '../../lib/motion-presets'
import { useNavigationStore, type AppView } from '../../stores/navigation'
import styles from './AppShell.module.css'
import { PlaylistDetailView } from '../Playlist/PlaylistDetailView'
import { initialPageTransition, isDetailView, nextPageTransition } from './page-transition-state'

const ExplorePage = lazy(() => import('../../pages/ExplorePage').then((m) => ({ default: m.ExplorePage })))
const LibraryPage = lazy(() => import('../../pages/LibraryPage').then((m) => ({ default: m.LibraryPage })))
const RoamPage = lazy(() => import('../../pages/RoamPage').then((m) => ({ default: m.RoamPage })))
const SettingsPage = lazy(() => import('../../pages/SettingsPage').then((m) => ({ default: m.SettingsPage })))
const ReleaseHistoryPage = lazy(() => import('../../pages/ReleaseHistoryPage').then((m) => ({ default: m.ReleaseHistoryPage })))
const ArtistPage = lazy(() => import('../../pages/ArtistPage').then((m) => ({ default: m.ArtistPage })))
const ArtistSongsPage = lazy(() => import('../../pages/ArtistSongsPage').then((m) => ({ default: m.ArtistSongsPage })))
const ToplistPage = lazy(() => import('../../pages/ToplistPage').then((m) => ({ default: m.ToplistPage })))
const AppleChartPage = lazy(() => import('../../pages/AppleChartPage').then((m) => ({ default: m.AppleChartPage })))
const ShuangePage = lazy(() => import('../../pages/ShuangePage').then((m) => ({ default: m.ShuangePage })))
const SearchPage = lazy(() => import('../../pages/SearchPage').then((m) => ({ default: m.SearchPage })))

/** 页面往返只做短距离淡入淡出，避免内容缩放与子页面入场动画叠加。 */
const pageVariants: Variants = {
  enter: (dir: 1 | -1) => ({ opacity: 0, x: 8 * dir }),
  center: { opacity: 1, x: 0 },
  exit: (dir: 1 | -1) => ({ opacity: 0, x: -8 * dir }),
}

export function AppShell() {
  const view = useNavigationStore((s) => s.currentView)
  const lastAction = useNavigationStore((s) => s.lastAction)
  const revision = useNavigationStore((s) => s.navigationRevision)
  // 仅在详情打开期间保留一个来源页，返回时沿用其卡片、分类及滚动位置。
  const [transition, setTransition] = useState(() => initialPageTransition(view, revision))
  const pages = nextPageTransition(transition, view, revision, lastAction)
  if (pages !== transition) setTransition(pages)
  const dir: 1 | -1 = lastAction === 'pop' ? -1 : 1

  const renderPage = (view: AppView) => {
    if (view === 'explore') return <ExplorePage />
    if (view === 'library') return <LibraryPage />
    if (view === 'roam') return <RoamPage />
    if (view === 'shuange') return <ShuangePage />
    if (view === 'settings') return <SettingsPage />
    if (view === 'release-history') return <ReleaseHistoryPage />
    if (typeof view === 'object' && view.type === 'search') {
      return <SearchPage keyword={view.keyword} initialState={view.pageState} />
    }
    if (typeof view === 'object' && view.type === 'toplist') return view.source === 'apple' ? <AppleChartPage /> : <ToplistPage />
    if (typeof view === 'object' && view.type === 'artist') {
      return <ArtistPage id={view.id} source={view.source} initialState={view.pageState} />
    }
    if (typeof view === 'object' && view.type === 'artistSongs') {
      return <ArtistSongsPage id={view.id} source={view.source} />
    }
    if (typeof view === 'object' && view.type === 'playlist') {
      return <PlaylistDetailView playlist={view.playlist} initialTracks={view.tracks}
        layoutIdPrefix={view.from === 'library' ? `library-cover-${view.playlist.source}` : 'explore-cover'} />
    }
    return <ExplorePage />
  }

  return (
    <div className={styles.shell}>
      <div className={styles.contentRegion} aria-hidden="true" />
      {/* Suspense 必须在 motion.div 内:lazy 页首挂载的挂起若发生在 AnimatePresence
          子节点层,会打断旧页 exit,旧页永久滞留盖住新页(首次导航跳转失效) */}
      <LayoutGroup>
        <AnimatePresence mode="popLayout" initial={false} custom={dir}>
          {[...(pages.origin ? [{ ...pages.origin, hidden: true }] : []),
            { ...pages.current, hidden: false }].map((page) => <motion.div
            key={page.key}
            className={`${styles.page}${page.hidden ? ` ${styles.retainedPage}` : ''}`}
            aria-hidden={page.hidden || undefined}
            {...(page.hidden ? { inert: '' } : {})}
            custom={dir}
            variants={pageVariants}
            initial={isDetailView(page.view) ? false : 'enter'}
            animate="center"
            exit="exit"
            transition={pageTransition}
          >
            <Suspense fallback={
              <div className={styles.loading} role="status">
                <span className={styles.loadingMark} aria-hidden="true">
                  <span /><span /><span />
                </span>
                <p>正在加载页面…</p>
              </div>
            }>
              {renderPage(page.view)}
            </Suspense>
          </motion.div>)}
        </AnimatePresence>
      </LayoutGroup>
    </div>
  )
}
