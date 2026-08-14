import { memo, useEffect, useRef, useState } from 'react'
import { usePlaylistStore } from '../stores/playlist'
import { useNavigationStore } from '../stores/navigation'
import { useRecentPlaysStore } from '../stores/recent'
import { useProviderStore } from '../stores/providers'
import { useContentProvider } from '../hooks/useContentProvider'
import { useToastStore } from '../stores/toast'
import { localMusicService } from '../lib/local-music-service'
import { runProviderTasks, type ProviderResult } from '../lib/content-hub'
import { providerFor } from '../providers/registry'
import type { ProviderId } from '../providers/types'
import { PlaylistCard } from '../components/Explore/PlaylistCard'
import { PlaylistDetailView } from '../components/Playlist/PlaylistDetailView'
import { TrackRow } from '../components/Explore/TrackRow'
import { GradientText } from '../components/ui/GradientText'
import { ScrollArea } from '../components/ui/ScrollArea'
import { SourceBadge } from '../components/ui/SourceBadge'
import type { Playlist, Track } from '../types/domain'
import type { MutableRefObject } from 'react'
import styles from './LibraryPage.module.css'

type SubTab = 'playlists' | 'favorites' | 'recent' | 'local'

/** 本地音乐列表视图:平铺 / 按艺人分组 / 按专辑分组。 */
type LocalViewMode = 'flat' | 'artist' | 'album'

/** 按艺人或专辑对 filtered 分组,保留每首曲目在 filtered 中的全局下标(供入队 playAt 用)。 */
function groupTracks(
  tracks: Track[],
  mode: LocalViewMode
): [string, { track: Track; index: number }[]][] {
  const keyFn = mode === 'artist' ? (t: Track) => t.artist || '未知艺人' : (t: Track) => t.album || '未知专辑'
  const map = new Map<string, { track: Track; index: number }[]>()
  tracks.forEach((track, index) => {
    const k = keyFn(track)
    const arr = map.get(k)
    if (arr) arr.push({ track, index })
    else map.set(k, [{ track, index }])
  })
  return [...map]
}

/** 分组折叠视图:默认全展开,点头部收起/展开。 */
function LocalGroupedView({
  filtered,
  queueRef,
  mode,
}: {
  filtered: Track[]
  queueRef: MutableRefObject<Track[]>
  mode: LocalViewMode
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const groups = groupTracks(filtered, mode)
  return (
    <>
      {groups.map(([key, items]) => {
        const isCollapsed = collapsed.has(key)
        return (
          <div className={styles.groupSection} key={key}>
            <button
              type="button"
              className={`${styles.groupHeader} no-drag`}
              aria-expanded={!isCollapsed}
              onClick={() =>
                setCollapsed((s) => {
                  const next = new Set(s)
                  if (next.has(key)) next.delete(key)
                  else next.add(key)
                  return next
                })
              }
            >
              <span className={styles.groupArrow} data-collapsed={isCollapsed} aria-hidden="true">
                ▸
              </span>
              <span className={styles.groupTitle}>{key}</span>
              <span className={styles.groupCount}>{items.length} 首</span>
            </button>
            {!isCollapsed &&
              items.map(({ track, index }) => (
                <QueuedTrackRow key={String(track.id)} track={track} index={index} queueRef={queueRef} />
              ))}
          </div>
        )
      })}
    </>
  )
}

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
      layoutId={`library-cover-${playlist.source}-${String(playlist.id)}`}
    />
  )
})

/** 队列行：onPlay 通过 ref 取最新队列 + 行内 index，引用永久稳定，
 *  父级因搜索/切 tab 等无关重渲染时，track/index 未变的行不再重建 vnode。
 *  queueRef.current 在父级每次渲染时刷新为最新队列数组。 */
const QueuedTrackRow = memo(function QueuedTrackRow({
  track,
  index,
  queueRef,
}: {
  track: Track
  index: number
  queueRef: MutableRefObject<Track[]>
}) {
  return (
    <TrackRow
      track={track}
      index={index}
      onPlay={() => usePlaylistStore.getState().setQueue(queueRef.current, index)}
    />
  )
})

export function LibraryPage() {
  const [tab, setTab] = useState<SubTab>('playlists')
  const { current: contentSource } = useContentProvider()

  // 歌单详情提升到导航 store：顶栏前进/后退可穿越
  const currentView = useNavigationStore((s) => s.currentView)
  const detail =
    typeof currentView === 'object' && currentView.type === 'playlist' && currentView.from === 'library'
      ? currentView
      : null

  if (detail) {
    return <PlaylistDetailView
      playlist={detail.playlist}
      initialTracks={detail.tracks}
      layoutIdPrefix={`library-cover-${detail.playlist.source}`}
    />
  }

  return (
    <ScrollArea className={styles.page}>
      <div className={styles.inner}>
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

      {tab === 'playlists' && (contentSource
        ? <ProviderLibraryGrid mode="playlists" source={contentSource} />
        : <div className={styles.emptyHint}><p>没有已启用的在线音乐平台</p></div>)}

      {tab === 'favorites' && (contentSource
        ? <ProviderLibraryGrid mode="favorites" source={contentSource} />
        : <div className={styles.emptyHint}><p>没有已启用的在线音乐平台</p></div>)}

      {tab === 'recent' && <RecentPlaysList />}

      {tab === 'local' && <LocalMusicTab />}
      </div>
    </ScrollArea>
  )
}

interface ProviderLibraryGridProps {
  mode: 'playlists' | 'favorites'
  source: ProviderId
}

async function loadProviderLibrary(source: ProviderId, mode: ProviderLibraryGridProps['mode']): Promise<Playlist[]> {
  const library = providerFor(source).library
  if (mode === 'playlists') return library?.getUserPlaylists?.() ?? []
  const liked = await library?.getLikedPlaylist?.()
  return liked ? [liked] : []
}

function isProviderParticipating(source: ProviderId): boolean {
  const state = useProviderStore.getState().byId[source]
  return state.enabled && state.auth === 'authenticated'
}

function ProviderLibraryGrid({ mode, source }: ProviderLibraryGridProps) {
  const participating = useProviderStore((state) =>
    state.byId[source].enabled && state.byId[source].auth === 'authenticated'
  )
  const [results, setResults] = useState<Partial<Record<ProviderId, ProviderResult<Playlist[]>>>>({})
  const sessionRef = useRef(0)
  const retryRef = useRef<Partial<Record<ProviderId, number>>>({})

  useEffect(() => {
    const session = ++sessionRef.current
    const controller = new AbortController()
    setResults({})
    void runProviderTasks(
      [source],
      (source) => loadProviderLibrary(source, mode),
      {
        signal: controller.signal,
        isEnabled: isProviderParticipating,
        isEmpty: (playlists) => playlists.length === 0,
        onUpdate: (result) => {
          if (session !== sessionRef.current) return
          setResults((current) => ({ ...current, [result.source]: result }))
        },
      }
    )
    return () => {
      sessionRef.current += 1
      controller.abort()
    }
  }, [mode, participating, source])

  function retryProvider(source: ProviderId): void {
    const session = sessionRef.current
    const retry = (retryRef.current[source] ?? 0) + 1
    retryRef.current[source] = retry
    void runProviderTasks(
      [source],
      (currentSource) => loadProviderLibrary(currentSource, mode),
      {
        isEnabled: isProviderParticipating,
        isEmpty: (playlists) => playlists.length === 0,
        onUpdate: (result) => {
          if (session !== sessionRef.current || retryRef.current[source] !== retry) return
          setResults((current) => ({ ...current, [result.source]: result }))
        },
      }
    )
  }

  const visibleSources = participating ? [source] : []

  if (visibleSources.length === 0) {
    return <div className={styles.emptyHint}><p>没有已启用的在线音乐平台</p></div>
  }

  return (
    <div className={styles.providerSections}>
      {visibleSources.map((source) => {
        const result = results[source]
        const playlists = result?.data ?? []
        return (
          <section className={styles.providerSection} key={source} aria-label={`${source}音乐库`}>
            <div className={styles.providerSectionHeader}>
              <SourceBadge source={source} reveal />
              <strong>{providerFor(source).descriptor.label}</strong>
              <span>
                {result?.status === 'loading' || !result
                  ? '加载中…'
                  : result.status === 'error'
                    ? result.error?.message
                    : `${playlists.length} 个${mode === 'favorites' ? '收藏入口' : '歌单'}`}
              </span>
            </div>
            {result?.status === 'error' ? (
              <div className={styles.providerError}>
                <p>这个平台暂时无法加载，请稍后重试。</p>
                <button className="no-drag" onClick={() => retryProvider(source)}>重试</button>
              </div>
            ) : result?.status === 'empty' ? (
              <div className={styles.providerEmpty}>
                {mode === 'favorites' ? '这个平台没有可展示的收藏入口' : '这个平台暂时没有歌单，或需要先登录'}
              </div>
            ) : playlists.length > 0 ? (
              <div className={styles.grid}>
                {playlists.map((playlist) => (
                  <PlaylistGridItem key={`${playlist.source}:${String(playlist.id)}`} playlist={playlist} />
                ))}
              </div>
            ) : null}
          </section>
        )
      })}
    </div>
  )
}

/** 本地播放历史列表:点击整单入队从该曲播起。 */
function RecentPlaysList() {
  const items = useRecentPlaysStore((s) => s.items)
  const queueRef = useRef<Track[]>([])
  queueRef.current = items.map((r) => r.track)

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
        <QueuedTrackRow
          key={`${String(it.track.id)}-${it.playedAt}`}
          track={it.track}
          index={i}
          queueRef={queueRef}
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
  const [viewMode, setViewMode] = useState<LocalViewMode>('flat')

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
  const queueRef = useRef<Track[]>([])
  queueRef.current = filtered

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
          <div className={styles.viewSwitch} role="tablist" aria-label="列表视图">
            {(['flat', 'artist', 'album'] as LocalViewMode[]).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={viewMode === m}
                className={`${styles.viewSwitchBtn} no-drag${viewMode === m ? ` ${styles.viewSwitchActive}` : ''}`}
                onClick={() => setViewMode(m)}
              >
                {{ flat: '列表', artist: '艺人', album: '专辑' }[m]}
              </button>
            ))}
          </div>
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
      ) : viewMode === 'flat' ? (
        filtered.map((t, i) => (
          <QueuedTrackRow key={String(t.id)} track={t} index={i} queueRef={queueRef} />
        ))
      ) : (
        <LocalGroupedView filtered={filtered} queueRef={queueRef} mode={viewMode} />
      )}
    </div>
  )
}
