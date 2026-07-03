import { lazy, Suspense } from 'react'
import { useNavigationStore } from '../../stores/navigation'
import { useAmbientStore } from '../../stores/ambient'
import { useVisualStore } from '../../stores/visual'
import { usePlayerStore } from '../../stores/player'
import LiquidEther from '../Visualizer/LiquidEther'
import styles from './AppShell.module.css'

const ExplorePage = lazy(() => import('../../pages/ExplorePage').then((m) => ({ default: m.ExplorePage })))
const LibraryPage = lazy(() => import('../../pages/LibraryPage').then((m) => ({ default: m.LibraryPage })))
const SettingsPage = lazy(() => import('../../pages/SettingsPage').then((m) => ({ default: m.SettingsPage })))
const ArtistPage = lazy(() => import('../../pages/ArtistPage').then((m) => ({ default: m.ArtistPage })))

interface AppShellProps {
  /** 为 true 时隐藏背景层(如歌词页 3D 模式打开,保证同屏只有一个全屏 WebGL)。 */
  backgroundHidden?: boolean
}

export function AppShell({ backgroundHidden }: AppShellProps) {
  const view = useNavigationStore((s) => s.currentView)
  const palette = useAmbientStore((s) => s.palette)
  const performanceMode = useVisualStore((s) => s.performanceMode)
  const playing = usePlayerStore((s) => s.status === 'playing')

  const viewKey = typeof view === 'string' ? view : `${view.type}-${String(view.id)}`

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
            autoSpeed={playing ? 0.45 : 0.25}
            autoIntensity={playing ? 1.8 : 1.2}
            autoResumeDelay={2000}
          />
        )}
      </div>
      <Suspense fallback={<div className={styles.loading} />}>
        <div key={viewKey} className={styles.pageEnter}>
          {renderPage()}
        </div>
      </Suspense>
    </div>
  )
}
