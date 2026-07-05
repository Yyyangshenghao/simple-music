import { useEffect, useState } from 'react'
import { usePlaylistStore } from '../stores/playlist'
import { useNavigationStore } from '../stores/navigation'
import { PlaylistCard } from '../components/Explore/PlaylistCard'
import { PlaylistDetailView } from '../components/Playlist/PlaylistDetailView'
import { GradientText } from '../components/ui/GradientText'
import type { Playlist } from '../types/domain'
import styles from './LibraryPage.module.css'

type SubTab = 'playlists' | 'favorites' | 'recent'

export function LibraryPage() {
  const [tab, setTab] = useState<SubTab>('playlists')
  const [playlists, setPlaylists] = useState<Playlist[]>([])

  // 歌单详情提升到导航 store：顶栏前进/后退可穿越
  const currentView = useNavigationStore((s) => s.currentView)
  const detail =
    typeof currentView === 'object' && currentView.type === 'playlist' && currentView.from === 'library'
      ? currentView
      : null

  const playlistsFromStore = usePlaylistStore((s) => s.playlists)

  useEffect(() => {
    setPlaylists(playlistsFromStore)
    if (playlistsFromStore.length === 0) {
      void usePlaylistStore.getState().loadUserPlaylists()
    }
  }, [playlistsFromStore])

  function openPlaylist(playlist: Playlist) {
    useNavigationStore.getState().navigateTo({ type: 'playlist', from: 'library', playlist })
  }

  if (detail) {
    return <PlaylistDetailView playlist={detail.playlist} initialTracks={detail.tracks} layoutIdPrefix="library-cover" />
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.pageTitle}><GradientText>我的库</GradientText></h1>
        <div className={styles.subTabs}>
          {(['playlists', 'favorites', 'recent'] as SubTab[]).map((t) => (
            <button
              key={t}
              className={`${styles.subTab} no-drag ${tab === t ? styles.subTabActive : ''}`}
              onClick={() => setTab(t)}
            >
              {{ playlists: '歌单', favorites: '收藏', recent: '最近播放' }[t]}
            </button>
          ))}
        </div>
      </div>

      {tab === 'playlists' && (
        <div className={styles.grid}>
          {playlists.map((pl, i) => (
            <PlaylistCard
              key={String(pl.id) + i}
              playlist={pl}
              onClick={() => openPlaylist(pl)}
              layoutId={`library-cover-${String(pl.id)}`}
            />
          ))}
        </div>
      )}

      {tab === 'favorites' && (
        <div className={styles.emptyHint}>
          <p>收藏功能即将上线</p>
        </div>
      )}

      {tab === 'recent' && (
        <div className={styles.emptyHint}>
          <p>最近播放功能即将上线</p>
        </div>
      )}
    </div>
  )
}
