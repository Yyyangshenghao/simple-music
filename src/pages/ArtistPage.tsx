import { useEffect, useState } from 'react'
import { useMusicService } from '../hooks/useMusicService'
import { useNavigationStore } from '../stores/navigation'
import { usePlaylistStore } from '../stores/playlist'
import { ArtistHeader } from '../components/Artist/ArtistHeader'
import { TrackRow } from '../components/Explore/TrackRow'
import { PlaylistCard } from '../components/Explore/PlaylistCard'
import { CardRail } from '../components/Explore/CardRail'
import type { ArtistInfo, Track, Playlist } from '../types/domain'
import styles from './ArtistPage.module.css'

type ArtistTab = 'songs' | 'albums'

interface ArtistPageProps {
  id: unknown
  source: 'netease' | 'qq'
}

export function ArtistPage({ id }: ArtistPageProps) {
  const [artist, setArtist] = useState<ArtistInfo | null>(null)
  const [songs, setSongs] = useState<Track[]>([])
  const [albums, setAlbums] = useState<Playlist[]>([])
  const [tab, setTab] = useState<ArtistTab>('songs')
  const service = useMusicService()
  const goBack = useNavigationStore((s) => s.goBack)

  useEffect(() => {
    setArtist(null); setSongs([]); setAlbums([])
    void service.getArtistDetail(id).then(setArtist).catch(() => {})
    void service.getArtistSongs(id).then(setSongs).catch(() => {})
    void service.getArtistAlbums(id).then(setAlbums).catch(() => {})
  }, [id, service])

  function playAll() {
    if (songs.length) usePlaylistStore.getState().setQueue(songs, 0)
  }

  function playTrack(index: number) {
    usePlaylistStore.getState().setQueue(songs, index)
  }

  return (
    <div className={styles.page}>
      <button className={`${styles.back} no-drag`} onClick={goBack}>← 返回</button>

      {artist && <ArtistHeader artist={artist} onPlayAll={playAll} />}

      <div className={styles.subTabs}>
        {(['songs', 'albums'] as ArtistTab[]).map((t) => (
          <button
            key={t}
            className={`${styles.subTab} no-drag ${tab === t ? styles.active : ''}`}
            onClick={() => setTab(t)}
          >
            {{ songs: '热门单曲', albums: '专辑' }[t]}
          </button>
        ))}
      </div>

      {tab === 'songs' && (
        <div className={styles.trackList}>
          {songs.map((s, i) => (
            <TrackRow key={String(s.id) + i} track={s} index={i} onPlay={() => playTrack(i)} />
          ))}
        </div>
      )}

      {tab === 'albums' && albums.length > 0 && (
        <CardRail title="">
          {albums.map((a, i) => (
            <PlaylistCard key={String(a.id) + i} playlist={a} onClick={() => {}} />
          ))}
        </CardRail>
      )}
    </div>
  )
}
