import { memo, useEffect, useState } from 'react'
import { usePlaylistStore } from '../stores/playlist'
import { useNavigationStore } from '../stores/navigation'
import { useRecentPlaysStore } from '../stores/recent'
import { useSettingsStore } from '../stores/settings'
import { useMusicService } from '../hooks/useMusicService'
import { useToastStore } from '../stores/toast'
import { localMusicService } from '../lib/local-music-service'
import { PlaylistCard } from '../components/Explore/PlaylistCard'
import { PlaylistDetailView } from '../components/Playlist/PlaylistDetailView'
import { TrackRow } from '../components/Explore/TrackRow'
import { GradientText } from '../components/ui/GradientText'
import { ScrollArea } from '../components/ui/ScrollArea'
import type { Playlist, Track } from '../types/domain'
import styles from './LibraryPage.module.css'

type SubTab = 'playlists' | 'favorites' | 'recent' | 'local'

// 不闭包任何组件内状态，可提到模块作用域，引用永久稳定
function openPlaylist(playlist: Playlist) {
  useNavigationStore.getState().navigateTo({ type: 'playlist', from: 'library', playlist })
}

/** 歌单网格单项：onOpen 引用稳定时，网格与该项无关的重渲染（如切 tab、搜索本地音乐）不会波及未变化的卡片。 */
const PlaylistGridItem = memo(function PlaylistGridItem({ playlist }: { playlist: Playlist }) {
  return (
    <PlaylistCard
      playlist={playlist}
      onClick={() => openPlaylist(playlist)}
      layoutId={`library-cover-${String(playlist.id)}`}
    />
  )
})

export function LibraryPage() {
  const [tab, setTab] = useState<SubTab>('playlists')

  // 歌单详情提升到导航 store：顶栏前进/后退可穿越
  const currentView = useNavigationStore((s) => s.currentView)
  const detail =
    typeof currentView === 'object' && currentView.type === 'playlist' && currentView.from === 'library'
      ? currentView
      : null

  const playlists = usePlaylistStore((s) => s.playlists)
  const playlistsSource = usePlaylistStore((s) => s.playlistsSource)
  const activeSource = useSettingsStore((s) => s.activeSource)

  // 拉取条件看"已拉的是不是当前音源"，不能看 length===0：
  // 未登录/拉取失败时结果恒为空数组，而 store 每次 set 都是新数组引用，
  // 用 length 判断会让本 effect 无限重入，把接口打爆。
  useEffect(() => {
    if (playlistsSource !== activeSource) {
      void usePlaylistStore.getState().loadUserPlaylists()
    }
  }, [playlistsSource, activeSource])

  if (detail) {
    return <PlaylistDetailView playlist={detail.playlist} initialTracks={detail.tracks} layoutIdPrefix="library-cover" />
  }

  return (
    <ScrollArea className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.pageTitle}><GradientText>我的库</GradientText></h1>
        <div className={styles.subTabs}>
          {(['playlists', 'favorites', 'recent', 'local'] as SubTab[]).map((t) => (
            <button
              key={t}
              className={`${styles.subTab} no-drag ${tab === t ? styles.subTabActive : ''}`}
              onClick={() => setTab(t)}
            >
              {{ playlists: '歌单', favorites: '收藏', recent: '最近播放', local: '本地音乐' }[t]}
            </button>
          ))}
        </div>
      </div>

      {tab === 'playlists' && (
        <div className={styles.grid}>
          {playlists.map((pl, i) => (
            <PlaylistGridItem key={String(pl.id) + i} playlist={pl} />
          ))}
        </div>
      )}

      {tab === 'favorites' && <FavoritesTab onOpen={openPlaylist} />}

      {tab === 'recent' && <RecentPlaysList />}

      {tab === 'local' && <LocalMusicTab />}
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

/** 本地音乐 tab:选文件夹批量导入,扁平列表播放;不接入在线音源的推荐/艺人体系。 */
function LocalMusicTab() {
  const [folders, setFolders] = useState<string[]>([])
  const [tracks, setTracks] = useState<Track[]>([])
  const [keyword, setKeyword] = useState('')
  const [scanning, setScanning] = useState(false)

  async function refresh(): Promise<void> {
    const [f, t] = await Promise.all([localMusicService.listFolders(), localMusicService.listAllTracks()])
    setFolders(f)
    setTracks(t)
  }

  useEffect(() => {
    void refresh()
  }, [])

  async function handleAddFolder(): Promise<void> {
    const picker = window.desktop?.selectDirectory
    if (!picker) return
    const r = await picker({ title: '选择本地音乐文件夹' })
    if (!r.ok || !r.filePath) return
    setScanning(true)
    try {
      await localMusicService.addFolder(r.filePath)
      await refresh()
    } catch {
      useToastStore.getState().show('导入失败,请重试')
    } finally {
      setScanning(false)
    }
  }

  async function handleRemoveFolder(folder: string): Promise<void> {
    await localMusicService.removeFolder(folder)
    await refresh()
  }

  const kw = keyword.trim().toLowerCase()
  const filtered = kw
    ? tracks.filter((t) => t.name.toLowerCase().includes(kw) || t.artist.toLowerCase().includes(kw))
    : tracks

  return (
    <div className={styles.trackList}>
      <div className={styles.trackListToolbar}>
        <span className={styles.trackListCount}>{tracks.length} 首</span>
        <div className={styles.toolbarActions}>
          <input
            className={styles.searchInput}
            placeholder="搜索本地音乐"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          <button className={`${styles.clearBtn} no-drag`} onClick={() => void handleAddFolder()} disabled={scanning}>
            {scanning ? '导入中…' : '添加文件夹'}
          </button>
        </div>
      </div>

      {folders.length > 0 && (
        <div className={styles.folderList}>
          {folders.map((f) => (
            <span key={f} className={styles.folderChip}>
              {f}
              <button
                className={`${styles.folderChipRemove} no-drag`}
                onClick={() => void handleRemoveFolder(f)}
                aria-label="移除文件夹"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className={styles.emptyHint}>
          <p>{tracks.length === 0 ? '还没有导入本地音乐,点击「添加文件夹」开始' : '没有匹配的曲目'}</p>
        </div>
      ) : (
        filtered.map((t, i) => (
          <TrackRow key={String(t.id)} track={t} index={i} onPlay={() => usePlaylistStore.getState().setQueue(filtered, i)} />
        ))
      )}
    </div>
  )
}
