import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { useMusicService } from '../hooks/useMusicService'
import { useScrollGradient } from '../hooks/useScrollGradient'
import { usePlaylistStore } from '../stores/playlist'
import { useNavigationStore } from '../stores/navigation'
import { PlaylistCard } from '../components/Explore/PlaylistCard'
import { AnimatedTrackRow } from '../components/Explore/AnimatedTrackRow'
import { GradientText } from '../components/ui/GradientText'
import { fadeRise, springGentle } from '../lib/motion-presets'
import type { Playlist, Track } from '../types/domain'
import styles from './LibraryPage.module.css'

type SubTab = 'playlists' | 'favorites' | 'recent'

export function LibraryPage() {
  const [tab, setTab] = useState<SubTab>('playlists')
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [loadingId, setLoadingId] = useState<unknown>(null)

  // 歌单详情提升到导航 store：顶栏前进/后退可穿越
  const currentView = useNavigationStore((s) => s.currentView)
  const detail =
    typeof currentView === 'object' && currentView.type === 'playlist' && currentView.from === 'library'
      ? currentView
      : null

  const { topOpacity, bottomOpacity, handleScroll, setTopOpacity, setBottomOpacity } = useScrollGradient()

  const service = useMusicService()
  const playlistsFromStore = usePlaylistStore((s) => s.playlists)

  useEffect(() => {
    setPlaylists(playlistsFromStore)
    if (playlistsFromStore.length === 0) {
      void usePlaylistStore.getState().loadUserPlaylists()
    }
  }, [playlistsFromStore])

  async function openPlaylist(playlist: Playlist) {
    setLoadingId(playlist.id)
    try {
      const tracks = await service.getPlaylistDetail(playlist.id)
      useNavigationStore.getState().navigateTo({ type: 'playlist', from: 'library', playlist, tracks })
    } finally {
      setLoadingId(null)
    }
  }

  // 详情开合的所有路径（页内返回键、顶栏前进/后退）都重置滚动渐变遮罩
  useEffect(() => {
    setTopOpacity(0)
    setBottomOpacity(0)
  }, [detail, setTopOpacity, setBottomOpacity])

  function playTrack(list: Track[], index: number) {
    usePlaylistStore.getState().setQueue(list, index)
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
                layoutId={`library-cover-${String(detail.playlist.id)}`}
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
              onClick={() => { if (!loadingId) void openPlaylist(pl) }}
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
