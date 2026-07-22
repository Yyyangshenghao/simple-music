import { useEffect, useMemo, useState } from 'react'
import { motion } from 'motion/react'
import { serviceFor } from '../lib/service-registry'
import { useNavigationStore } from '../stores/navigation'
import { usePlaylistStore } from '../stores/playlist'
import { useBackdropStore } from '../stores/backdrop'
import { ArtistHeader } from '../components/Artist/ArtistHeader'
import { TrackRow } from '../components/Explore/TrackRow'
import { PlaylistCard } from '../components/Explore/PlaylistCard'
import { ArtistPill } from '../components/Explore/ArtistPill'
import { ScrollArea } from '../components/ui/ScrollArea'
import { tapScale, springSnappy } from '../lib/motion-presets'
import type { ArtistInfo, MusicSource, Track, Playlist } from '../types/domain'
import styles from './ArtistPage.module.css'

type ArtistTab = 'songs' | 'albums' | 'similar'

interface ArtistPageProps {
  id: unknown
  source: 'netease' | 'qq'
}

export function ArtistPage({ id, source }: ArtistPageProps) {
  const [artist, setArtist] = useState<ArtistInfo | null>(null)
  const [songs, setSongs] = useState<Track[]>([])
  const [albums, setAlbums] = useState<Playlist[]>([])
  const [similar, setSimilar] = useState<ArtistInfo[]>([])
  const [similarLoaded, setSimilarLoaded] = useState(false)
  const [tab, setTab] = useState<ArtistTab>('songs')
  const [scrolled, setScrolled] = useState(false)
  // 必须按导航条目自带的 source 取 service：歌手可能来自另一音源（跨音源兜底的曲目、
  // 切换音源后回退的历史条目），用全局 activeSource 会把 netease 的 id 拿去查 QQ。
  const service = useMemo(() => serviceFor(source), [source])
  const goBack = useNavigationStore((s) => s.goBack)
  const navigateTo = useNavigationStore((s) => s.navigateTo)

  useEffect(() => {
    // 快速连点歌手时，先发的请求可能后返回；用 cancelled 丢弃过期响应
    let cancelled = false
    setArtist(null); setSongs([]); setAlbums([]); setSimilar([]); setSimilarLoaded(false)
    void service.getArtistDetail(id).then((v) => { if (!cancelled) setArtist(v) }).catch(() => {})
    void service.getArtistSongs(id).then((v) => { if (!cancelled) setSongs(v) }).catch(() => {})
    void service.getArtistAlbums(id).then((v) => { if (!cancelled) setAlbums(v) }).catch(() => {})
    if (service.getSimilarArtists) {
      void service.getSimilarArtists(id)
        .then((list) => { if (!cancelled) setSimilar(list) })
        .catch(() => {})
        .finally(() => { if (!cancelled) setSimilarLoaded(true) })
    } else {
      setSimilarLoaded(true)
    }
    return () => { cancelled = true }
  }, [id, service])

  // 相似歌手可能跨音源，跟着条目自己的 source 走，别沿用当前页的 source
  function openArtist(nextId: unknown, nextSource: MusicSource) {
    if (nextSource !== 'netease' && nextSource !== 'qq') return
    navigateTo({ type: 'artist', id: nextId, source: nextSource })
  }

  const tabs: ArtistTab[] = service.getSimilarArtists ? ['songs', 'albums', 'similar'] : ['songs', 'albums']

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
    <ScrollArea className={styles.page} onScrolledChange={setScrolled}>
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

      <div className={`${styles.subTabs} ${scrolled ? styles.subTabsScrolled : ''}`}>
        {tabs.map((t) => (
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
        <div className={styles.albumGrid}>
          {albums.map((a, i) => (
            <PlaylistCard
              key={String(a.id) + i}
              playlist={a}
              onClick={() => useNavigationStore.getState().navigateTo({ type: 'playlist', from: 'explore', playlist: a })}
            />
          ))}
        </div>
      )}

      {tab === 'similar' && (
        <div className={styles.similarGrid}>
          {similar.map((a, i) => (
            <ArtistPill key={String(a.id) + i} artist={a} onClick={() => openArtist(a.id, a.source)} />
          ))}
          {similarLoaded && similar.length === 0 && (
            <p className={styles.similarEmpty}>暂无相似歌手数据</p>
          )}
        </div>
      )}
    </ScrollArea>
  )
}
