import { useEffect, useState } from 'react'
import { useMusicService } from '../hooks/useMusicService'
import { useScrollGradient } from '../hooks/useScrollGradient'
import { usePlaylistStore } from '../stores/playlist'
import { HeroBanner } from '../components/Explore/HeroBanner'
import { CardRail } from '../components/Explore/CardRail'
import { PlaylistCard } from '../components/Explore/PlaylistCard'
import { AnimatedTrackRow } from '../components/Explore/AnimatedTrackRow'
import { RevealItem } from '../components/ui/RevealItem'
import type { Banner, Playlist, Track } from '../types/domain'
import styles from './ExplorePage.module.css'

export function ExplorePage() {
  const service = useMusicService()
  const [banners, setBanners] = useState<Banner[]>([])
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [songs, setSongs] = useState<Track[]>([])
  const [detail, setDetail] = useState<{ playlist: Playlist; tracks: Track[] } | null>(null)
  const [loadingId, setLoadingId] = useState<unknown>(null)

  const { topOpacity, bottomOpacity, handleScroll, setTopOpacity, setBottomOpacity } = useScrollGradient()

  useEffect(() => {
    void service.getRecommendBanners().then(setBanners).catch(() => {})
    void service.getRecommendPlaylists().then(setPlaylists).catch(() => {})
    void service.getNewSongs().then(setSongs).catch(() => {})
  }, [service])

  function playTrack(list: Track[], index: number) {
    usePlaylistStore.getState().setQueue(list, index)
  }

  async function openPlaylist(pl: Playlist) {
    setLoadingId(pl.id)
    try {
      const tracks = await service.getPlaylistDetail(pl.id)
      setDetail({ playlist: pl, tracks })
    } finally {
      setLoadingId(null)
    }
  }

  if (detail) {
    return (
      <div className={styles.page} onScroll={handleScroll}>
        <div className="topGradient" style={{ opacity: topOpacity }} />
        <div className={styles.detailHeader}>
          <button className={`${styles.backBtn} no-drag`} onClick={() => { setTopOpacity(0); setBottomOpacity(0); setDetail(null) }}>← 返回</button>
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
            <AnimatedTrackRow key={String(t.id) + i} track={t} index={i} onPlay={() => playTrack(detail.tracks, i)} delay={i * 0.05} />
          ))}
        </div>
        <div className="bottomGradient" style={{ opacity: bottomOpacity }} />
      </div>
    )
  }

  return (
    <div className={styles.page} onScroll={handleScroll}>
      <div className="topGradient" style={{ opacity: topOpacity }} />

      {banners.length > 0 && <HeroBanner banners={banners} />}

      {playlists.length > 0 && (
        <CardRail title="推荐歌单">
          {playlists.map((pl, i) => (
            <RevealItem key={String(pl.id) + i} delay={i * 0.04}>
              <PlaylistCard
                playlist={pl}
                onClick={() => { if (!loadingId) void openPlaylist(pl) }}
              />
            </RevealItem>
          ))}
        </CardRail>
      )}

      {songs.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>今日推荐</h2>
          <div className={styles.trackList}>
            {songs.map((s, i) => (
              <AnimatedTrackRow key={String(s.id) + i} track={s} index={i} onPlay={() => playTrack(songs, i)} delay={i * 0.05} />
            ))}
          </div>
        </section>
      )}

      <div className="bottomGradient" style={{ opacity: bottomOpacity }} />
    </div>
  )
}
