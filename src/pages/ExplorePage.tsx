import { useEffect, useState } from 'react'
import { useMusicService } from '../hooks/useMusicService'
import { usePlaylistStore } from '../stores/playlist'
import { HeroBanner } from '../components/Explore/HeroBanner'
import { CardRail } from '../components/Explore/CardRail'
import { PlaylistCard } from '../components/Explore/PlaylistCard'
import { TrackRow } from '../components/Explore/TrackRow'
import type { Banner, Playlist, Track } from '../types/domain'
import styles from './ExplorePage.module.css'

export function ExplorePage() {
  const service = useMusicService()
  const [banners, setBanners] = useState<Banner[]>([])
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [songs, setSongs] = useState<Track[]>([])

  useEffect(() => {
    void service.getRecommendBanners().then(setBanners).catch(() => {})
    void service.getRecommendPlaylists().then(setPlaylists).catch(() => {})
    void service.getNewSongs().then(setSongs).catch(() => {})
  }, [service])

  function playTrack(list: Track[], index: number) {
    usePlaylistStore.getState().setQueue(list, index)
  }

  return (
    <div className={styles.page}>
      {banners.length > 0 && <HeroBanner banners={banners} />}

      {playlists.length > 0 && (
        <CardRail title="推荐歌单">
          {playlists.map((pl, i) => (
            <PlaylistCard
              key={String(pl.id) + i}
              playlist={pl}
              onClick={() => playTrack(pl.tracks ?? [], 0)}
            />
          ))}
        </CardRail>
      )}

      {songs.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>今日推荐</h2>
          <div className={styles.trackList}>
            {songs.map((s, i) => (
              <TrackRow key={String(s.id) + i} track={s} index={i} onPlay={() => playTrack(songs, i)} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
