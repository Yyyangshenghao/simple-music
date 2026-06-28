import { lazy, Suspense } from 'react'
import { useNavigationStore } from '../../stores/navigation'
import styles from './AppShell.module.css'

const ExplorePage = lazy(() => import('../../pages/ExplorePage').then((m) => ({ default: m.ExplorePage })))
const LibraryPage = lazy(() => import('../../pages/LibraryPage').then((m) => ({ default: m.LibraryPage })))
const SettingsPage = lazy(() => import('../../pages/SettingsPage').then((m) => ({ default: m.SettingsPage })))
const ArtistPage = lazy(() => import('../../pages/ArtistPage').then((m) => ({ default: m.ArtistPage })))

export function AppShell() {
  const view = useNavigationStore((s) => s.currentView)

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
      <Suspense fallback={<div className={styles.loading} />}>
        {renderPage()}
      </Suspense>
    </div>
  )
}
