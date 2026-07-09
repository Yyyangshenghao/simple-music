import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { useMusicService } from '../hooks/useMusicService'
import { useNavigationStore } from '../stores/navigation'
import { usePlaylistStore } from '../stores/playlist'
import { useBackdropStore } from '../stores/backdrop'
import { ArtistHeader } from '../components/Artist/ArtistHeader'
import { TrackRow } from '../components/Explore/TrackRow'
import { PlaylistCard } from '../components/Explore/PlaylistCard'
import { CardRail } from '../components/Explore/CardRail'
import { tapScale, springSnappy } from '../lib/motion-presets'
import type { ArtistInfo, Track, Playlist } from '../types/domain'
import styles from './ArtistPage.module.css'

type ArtistTab = 'songs' | 'albums' | 'similar'

interface ArtistPageProps {
  id: unknown
  source: 'netease' | 'qq'
}

export function ArtistPage({ id, source: _source }: ArtistPageProps) {
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

  // 歌手头像模糊后作为全局背景(铺满整个应用);离开详情页时清空
  useEffect(() => {
    useBackdropStore.getState().setCover(artist?.avatar)
    return () => useBackdropStore.getState().setCover(null)
  }, [artist?.avatar])

  function playAll() {
    if (songs.length) usePlaylistStore.getState().setQueue(songs, 0)
  }

  function playTrack(index: number) {
    usePlaylistStore.getState().setQueue(songs, index)
  }

  return (
    <div className={styles.page}>
      <motion.button
        className={`${styles.back} no-drag`}
        onClick={goBack}
        aria-label="返回上一页"
        whileTap={tapScale}
        transition={springSnappy}
      >
        <svg
          className={styles.backIcon}
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M15 18l-6-6 6-6" />
        </svg>
        <span>返回</span>
      </motion.button>

      {artist && <ArtistHeader artist={artist} onPlayAll={playAll} />}

      <div className={styles.subTabs}>
        {(['songs', 'albums', 'similar'] as ArtistTab[]).map((t) => (
          <button
            key={t}
            className={`${styles.subTab} no-drag ${tab === t ? styles.active : ''}`}
            onClick={() => setTab(t)}
          >
            {{ songs: '热门单曲', albums: '专辑', similar: '相似歌手' }[t]}
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

      {tab === 'similar' && (
        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--sm-text-secondary)' }}>
          相似歌手功能即将上线
        </div>
      )}
    </div>
  )
}
