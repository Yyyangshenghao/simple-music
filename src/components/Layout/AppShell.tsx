import { lazy, Suspense } from 'react'
import { useNavigationStore } from '../../stores/navigation'
import LiquidEther from '../Visualizer/LiquidEther'
import styles from './AppShell.module.css'

const ExplorePage = lazy(() => import('../../pages/ExplorePage').then((m) => ({ default: m.ExplorePage })))
const LibraryPage = lazy(() => import('../../pages/LibraryPage').then((m) => ({ default: m.LibraryPage })))
const SettingsPage = lazy(() => import('../../pages/SettingsPage').then((m) => ({ default: m.SettingsPage })))
const ArtistPage = lazy(() => import('../../pages/ArtistPage').then((m) => ({ default: m.ArtistPage })))

export function AppShell() {
  const view = useNavigationStore((s) => s.currentView)

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
      <div className={styles.background}>
        <LiquidEther
          colors={['#5227FF', '#FF9FFC', '#B497CF']}
          mouseForce={12}
          cursorSize={80}
          resolution={0.4}
          autoDemo={true}
          autoSpeed={0.3}
          autoIntensity={1.4}
          autoResumeDelay={2000}
        />
      </div>
      <Suspense fallback={<div className={styles.loading} />}>
        <div key={viewKey} className={styles.pageEnter}>
          {renderPage()}
        </div>
      </Suspense>
    </div>
  )
}
