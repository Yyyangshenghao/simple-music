import { lazy, Suspense, useEffect } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { Variants } from 'motion/react'
import { useNavigationStore } from '../../stores/navigation'
import { springGentle } from '../../lib/motion-presets'
import { AmbientBackground } from './AmbientBackground'
import styles from './AppShell.module.css'

const ExplorePage = lazy(() => import('../../pages/ExplorePage').then((m) => ({ default: m.ExplorePage })))
const LibraryPage = lazy(() => import('../../pages/LibraryPage').then((m) => ({ default: m.LibraryPage })))
const SettingsPage = lazy(() => import('../../pages/SettingsPage').then((m) => ({ default: m.SettingsPage })))
const ArtistPage = lazy(() => import('../../pages/ArtistPage').then((m) => ({ default: m.ArtistPage })))

/** 纵深转场：新页从纵深浮上（scale 1.03→1），旧页缩小下沉；x 按 push/pop 反向。 */
const pageVariants: Variants = {
  enter: (dir: 1 | -1) => ({ opacity: 0, scale: 1.03, x: 24 * dir, y: 8 }),
  center: { opacity: 1, scale: 1, x: 0, y: 0 },
  exit: (dir: 1 | -1) => ({ opacity: 0, scale: 0.97, x: -24 * dir }),
}

interface AppShellProps {
  /** 为 true 时隐藏背景层(如歌词页 3D 模式打开,保证同屏只有一个全屏 WebGL)。 */
  backgroundHidden?: boolean
}

export function AppShell({ backgroundHidden }: AppShellProps) {
  const view = useNavigationStore((s) => s.currentView)
  const lastAction = useNavigationStore((s) => s.lastAction)

  // 空闲预热 lazy 页面 chunk：首次切页转场不再被模块加载打断
  useEffect(() => {
    const t = window.setTimeout(() => {
      void import('../../pages/ExplorePage')
      void import('../../pages/LibraryPage')
      void import('../../pages/SettingsPage')
      void import('../../pages/ArtistPage')
    }, 2000)
    return () => window.clearTimeout(t)
  }, [])

  // 歌单详情复用宿主页(探索/我的库)的 key:同一组件实例内切换,
  // 封面 layoutId 共享元素动画不被页面级转场打断
  const viewKey =
    typeof view === 'string' ? view
    : view.type === 'playlist' ? view.from
    : `${view.type}-${String(view.id)}`
  const dir: 1 | -1 = lastAction === 'pop' ? -1 : 1

  const renderPage = () => {
    if (view === 'explore') return <ExplorePage />
    if (view === 'library') return <LibraryPage />
    if (view === 'settings') return <SettingsPage />
    if (typeof view === 'object' && view.type === 'artist') {
      return <ArtistPage id={view.id} source={view.source} />
    }
    if (typeof view === 'object' && view.type === 'playlist') {
      return view.from === 'library' ? <LibraryPage /> : <ExplorePage />
    }
    return <ExplorePage />
  }

  return (
    <div className={styles.shell}>
      <AmbientBackground hidden={backgroundHidden} />
      <Suspense fallback={<div className={styles.loading} />}>
        <AnimatePresence mode="popLayout" initial={false} custom={dir}>
          <motion.div
            key={viewKey}
            className={styles.page}
            custom={dir}
            variants={pageVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={springGentle}
          >
            {renderPage()}
          </motion.div>
        </AnimatePresence>
      </Suspense>
    </div>
  )
}
