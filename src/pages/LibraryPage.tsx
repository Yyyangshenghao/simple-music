import { useEffect, useState } from 'react'
import { useMusicService } from '../hooks/useMusicService'
import { usePlaylistStore } from '../stores/playlist'
import { PlaylistCard } from '../components/Explore/PlaylistCard'
import { TrackRow } from '../components/Explore/TrackRow'
import type { Playlist, Track } from '../types/domain'
import styles from './LibraryPage.module.css'

type SubTab = 'playlists' | 'favorites' | 'recent'

export function LibraryPage() {
  const [tab, setTab] = useState<SubTab>('playlists')
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [detail, setDetail] = useState<{ playlist: Playlist; tracks: Track[] } | null>(null)

  const service = useMusicService()
  const playlistsFromStore = usePlaylistStore((s) => s.playlists)

  useEffect(() => {
    setPlaylists(playlistsFromStore)
    if (playlistsFromStore.length === 0) {
      void usePlaylistStore.getState().loadUserPlaylists()
    }
  }, [playlistsFromStore])

  async function openPlaylist(playlist: Playlist) {
    const tracks = await service.getPlaylistDetail(playlist.id)
    setDetail({ playlist, tracks })
  }

  function playTrack(list: Track[], index: number) {
    usePlaylistStore.getState().setQueue(list, index)
  }

  if (detail) {
    return (
      <div className={styles.page}>
        <div className={styles.detailHeader}>
          <button className={`${styles.backBtn} no-drag`} onClick={() => setDetail(null)}>← 返回</button>
          <div className={styles.detailMeta}>
            {detail.playlist.cover && (
              <img className={styles.detailCover} src={detail.playlist.cover} alt="" />
            )}
            <div>
              <h1 className={styles.detailTitle}>{detail.playlist.name}</h1>
              <p className={styles.detailSub}>{detail.tracks.length} 首</p>
            </div>
          </div>
        </div>
        <div className={styles.trackList}>
          {detail.tracks.map((t, i) => (
            <TrackRow key={String(t.id) + i} track={t} index={i} onPlay={() => playTrack(detail.tracks, i)} />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.pageTitle}>我的库</h1>
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
            <PlaylistCard key={String(pl.id) + i} playlist={pl} onClick={() => void openPlaylist(pl)} />
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
