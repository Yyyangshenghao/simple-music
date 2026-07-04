import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { useMusicService } from '../hooks/useMusicService'
import { useScrollGradient } from '../hooks/useScrollGradient'
import { usePlaylistStore } from '../stores/playlist'
import { useNavigationStore } from '../stores/navigation'
import { HeroBanner } from '../components/Explore/HeroBanner'
import { CardRail } from '../components/Explore/CardRail'
import { PlaylistCard } from '../components/Explore/PlaylistCard'
import { AnimatedTrackRow } from '../components/Explore/AnimatedTrackRow'
import { RevealItem } from '../components/ui/RevealItem'
import { GradientText } from '../components/ui/GradientText'
import { fadeRise, springGentle } from '../lib/motion-presets'
import type { Banner, Playlist, Track } from '../types/domain'
import styles from './ExplorePage.module.css'

export function ExplorePage() {
  const service = useMusicService()
  const [banners, setBanners] = useState<Banner[]>([])
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [songs, setSongs] = useState<Track[]>([])
  const [loadingId, setLoadingId] = useState<unknown>(null)
  // 入场 stagger 只在首次展示列表时播放；从详情返回时跳过，保证共享元素飞回干净
  const [revealPlayed, setRevealPlayed] = useState(false)

  // 歌单详情提升到导航 store：顶栏前进/后退可穿越
  const currentView = useNavigationStore((s) => s.currentView)
  const detail =
    typeof currentView === 'object' && currentView.type === 'playlist' && currentView.from === 'explore'
      ? currentView
      : null

  const { topOpacity, bottomOpacity, handleScroll, setTopOpacity, setBottomOpacity } = useScrollGradient()

  useEffect(() => {
    void service.getRecommendBanners().then(setBanners).catch(() => {})
    void service.getRecommendPlaylists().then(setPlaylists).catch(() => {})
    void service.getNewSongs().then(setSongs).catch(() => {})
  }, [service])

  // 详情开合的所有路径（页内返回键、顶栏前进/后退）都重置滚动渐变遮罩
  useEffect(() => {
    setTopOpacity(0)
    setBottomOpacity(0)
    if (detail) setRevealPlayed(true)
  }, [detail, setTopOpacity, setBottomOpacity])

  function playTrack(list: Track[], index: number) {
    usePlaylistStore.getState().setQueue(list, index)
  }

  async function openPlaylist(pl: Playlist) {
    setLoadingId(pl.id)
    try {
      const tracks = await service.getPlaylistDetail(pl.id)
      useNavigationStore.getState().navigateTo({ type: 'playlist', from: 'explore', playlist: pl, tracks })
    } finally {
      setLoadingId(null)
    }
  }

  if (detail) {
    return (
      <div className={styles.page} onScroll={handleScroll}>
        <div className="topGradient" style={{ opacity: topOpacity }} />
        <div className={styles.detailHeader}>
          <button className={`${styles.backBtn} no-drag`} onClick={() => useNavigationStore.getState().goBack()}>← 返回</button>
          <div className={styles.detailMeta}>
            {detail.playlist.cover && (
              <motion.img
                className={styles.detailCover}
                src={detail.playlist.cover}
                alt=""
                layoutId={`explore-cover-${String(detail.playlist.id)}`}
                transition={springGentle}
              />
            )}
            <motion.div variants={fadeRise} initial="hidden" animate="visible" transition={{ ...springGentle, delay: 0.15 }}>
              <h1 className={styles.detailTitle}><GradientText>{detail.playlist.name}</GradientText></h1>
              <p className={styles.detailSub}>{detail.tracks.length} 首</p>
            </motion.div>
          </div>
        </div>
        <motion.div className={styles.trackList} variants={fadeRise} initial="hidden" animate="visible" transition={{ ...springGentle, delay: 0.15 }}>
          {detail.tracks.map((t, i) => (
            <AnimatedTrackRow key={String(t.id) + i} track={t} index={i} onPlay={() => playTrack(detail.tracks, i)} delay={0.15 + i * 0.05} />
          ))}
        </motion.div>
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
            <RevealItem key={String(pl.id) + i} delay={Math.min(i, 8) * 0.04} disabled={revealPlayed}>
              <PlaylistCard
                playlist={pl}
                onClick={() => { if (!loadingId) void openPlaylist(pl) }}
                layoutId={`explore-cover-${String(pl.id)}`}
              />
            </RevealItem>
          ))}
        </CardRail>
      )}

      {songs.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}><GradientText>今日推荐</GradientText></h2>
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
