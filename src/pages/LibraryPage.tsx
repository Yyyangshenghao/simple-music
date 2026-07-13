import { useEffect, useState } from 'react'
import { usePlaylistStore } from '../stores/playlist'
import { useNavigationStore } from '../stores/navigation'
import { useRecentPlaysStore } from '../stores/recent'
import { useSettingsStore } from '../stores/settings'
import { useMusicService } from '../hooks/useMusicService'
import { PlaylistCard } from '../components/Explore/PlaylistCard'
import { PlaylistDetailView } from '../components/Playlist/PlaylistDetailView'
import { TrackRow } from '../components/Explore/TrackRow'
import { GradientText } from '../components/ui/GradientText'
import { ScrollArea } from '../components/ui/ScrollArea'
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
    <ScrollArea className={styles.page}>
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

      {tab === 'favorites' && <FavoritesTab onOpen={openPlaylist} />}

      {tab === 'recent' && <RecentPlaysList />}
    </ScrollArea>
  )
}

/** 收藏 tab:展示"我喜欢的音乐"歌单入口(音源需支持且已登录),点击进懒加载详情页。 */
function FavoritesTab({ onOpen }: { onOpen(playlist: Playlist): void }) {
  const service = useMusicService()
  const neteaseLoggedIn = useSettingsStore((s) => s.neteaseLoggedIn)
  const activeSource = useSettingsStore((s) => s.activeSource)
  const [playlist, setPlaylist] = useState<Playlist | null>(null)
  const [loading, setLoading] = useState(false)

  const supported = typeof service.getLikedPlaylist === 'function'
  const loggedIn = activeSource !== 'netease' || neteaseLoggedIn

  useEffect(() => {
    if (!supported || !loggedIn) return
    let stale = false
    setLoading(true)
    service
      .getLikedPlaylist!()
      .then((pl) => {
        if (!stale) setPlaylist(pl)
      })
      .catch(() => {
        if (!stale) setPlaylist(null)
      })
      .finally(() => {
        if (!stale) setLoading(false)
      })
    return () => {
      stale = true
    }
  }, [service, supported, loggedIn])

  if (!supported) return <div className={styles.emptyHint}><p>当前音源暂不支持收藏</p></div>
  if (!loggedIn) return <div className={styles.emptyHint}><p>登录网易云账号后可查看收藏</p></div>
  if (loading && !playlist) return <div className={styles.emptyHint}><p>加载中…</p></div>
  if (!playlist) return <div className={styles.emptyHint}><p>没有找到收藏歌单</p></div>

  return (
    <div className={styles.grid}>
      <PlaylistCard playlist={playlist} onClick={() => onOpen(playlist)} layoutId={`library-cover-${String(playlist.id)}`} />
    </div>
  )
}

/** 本地播放历史列表:点击整单入队从该曲播起。 */
function RecentPlaysList() {
  const items = useRecentPlaysStore((s) => s.items)

  if (!items.length) {
    return (
      <div className={styles.emptyHint}>
        <p>还没有播放记录,去探索页听点什么吧</p>
      </div>
    )
  }

  return (
    <div className={styles.trackList}>
      <div className={styles.trackListToolbar}>
        <span className={styles.trackListCount}>{items.length} 首</span>
        <button className={`${styles.clearBtn} no-drag`} onClick={() => useRecentPlaysStore.getState().clear()}>
          清空记录
        </button>
      </div>
      {items.map((it, i) => (
        <TrackRow
          key={`${String(it.track.id)}-${it.playedAt}`}
          track={it.track}
          index={i}
          onPlay={() =>
            usePlaylistStore.getState().setQueue(
              items.map((r) => r.track),
              i
            )
          }
        />
      ))}
    </div>
  )
}
