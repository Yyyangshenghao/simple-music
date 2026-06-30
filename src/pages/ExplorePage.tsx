import { useCallback, useEffect, useState } from 'react'
import { useMusicService } from '../hooks/useMusicService'
import { usePlaylistStore } from '../stores/playlist'
import { HeroBanner } from '../components/Explore/HeroBanner'
import { CardRail } from '../components/Explore/CardRail'
import { PlaylistCard } from '../components/Explore/PlaylistCard'
import { AnimatedTrackRow } from '../components/Explore/AnimatedTrackRow'
import type { Banner, Playlist, Track } from '../types/domain'
import styles from './ExplorePage.module.css'

export function ExplorePage() {
  const service = useMusicService()
  const [banners, setBanners] = useState<Banner[]>([])
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [songs, setSongs] = useState<Track[]>([])
  const [detail, setDetail] = useState<{ playlist: Playlist; tracks: Track[] } | null>(null)
  const [loadingId, setLoadingId] = useState<unknown>(null)

  // 渐变遮罩状态
  const [topOpacity, setTopOpacity] = useState(0)
  const [bottomOpacity, setBottomOpacity] = useState(0)

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

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget
    setTopOpacity(Math.min(scrollTop / 50, 1))
    const bottomDistance = scrollHeight - (scrollTop + clientHeight)
    setBottomOpacity(scrollHeight <= clientHeight ? 0 : Math.min(bottomDistance / 50, 1))
  }, [])

  if (detail) {
    return (
      <div className={styles.page} onScroll={handleScroll}>
        <div className="topGradient" style={{ opacity: topOpacity }} />
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
            <AnimatedTrackRow key={String(t.id) + i} track={t} index={i} onPlay={() => playTrack(detail.tracks, i)} />
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
            <PlaylistCard
              key={String(pl.id) + i}
              playlist={pl}
              onClick={() => { if (!loadingId) void openPlaylist(pl) }}
            />
          ))}
        </CardRail>
      )}

      {songs.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>今日推荐</h2>
          <div className={styles.trackList}>
            {songs.map((s, i) => (
              <AnimatedTrackRow key={String(s.id) + i} track={s} index={i} onPlay={() => playTrack(songs, i)} />
            ))}
          </div>
        </section>
      )}

      <div className="bottomGradient" style={{ opacity: bottomOpacity }} />
    </div>
  )
}
