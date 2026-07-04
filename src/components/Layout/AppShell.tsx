import { lazy, Suspense, useEffect, useState } from 'react'
import { AnimatePresence, motion, useMotionValueEvent, useSpring } from 'motion/react'
import type { Variants } from 'motion/react'
import { useNavigationStore } from '../../stores/navigation'
import { useAmbientStore } from '../../stores/ambient'
import { useVisualStore } from '../../stores/visual'
import { usePlayerStore } from '../../stores/player'
import { gentleSpringValues, springGentle } from '../../lib/motion-presets'
import LiquidEther from '../Visualizer/LiquidEther'
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
  const palette = useAmbientStore((s) => s.palette)
  const performanceMode = useVisualStore((s) => s.performanceMode)
  const playing = usePlayerStore((s) => s.status === 'playing')

  // 播放/暂停背景强度缓动：单弹簧 0↔1，避免流体参数跳变
  const playSpring = useSpring(playing ? 1 : 0, gentleSpringValues)
  const [playAmount, setPlayAmount] = useState(playing ? 1 : 0)
  useEffect(() => {
    playSpring.set(playing ? 1 : 0)
  }, [playing, playSpring])
  useMotionValueEvent(playSpring, 'change', (v) => setPlayAmount(v))

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

  const viewKey = typeof view === 'string' ? view : `${view.type}-${String(view.id)}`
  const dir: 1 | -1 = lastAction === 'pop' ? -1 : 1

  const renderPage = () => {
    if (view === 'explore') return <ExplorePage />
    if (view === 'library') return <LibraryPage />
    if (view === 'settings') return <SettingsPage />
    if (typeof view === 'object' && view.type === 'artist') {
      return <ArtistPage id={view.id} source={view.source} />
    }
    return <ExplorePage />
  }

  return (
    <div className={styles.shell}>
      {/* display:none 时 LiquidEther 内置 IntersectionObserver 自动暂停渲染 */}
      <div className={styles.background} style={backgroundHidden ? { display: 'none' } : undefined}>
        {performanceMode === 'eco' ? (
          <div className={styles.auroraFallback} aria-hidden="true" />
        ) : (
          <LiquidEther
            colors={palette}
            mouseForce={12}
            cursorSize={80}
            resolution={performanceMode === 'balanced' ? 0.4 : 0.5}
            autoDemo={true}
            autoSpeed={0.25 + 0.2 * playAmount}
            autoIntensity={1.2 + 0.6 * playAmount}
            autoResumeDelay={2000}
          />
        )}
      </div>
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
