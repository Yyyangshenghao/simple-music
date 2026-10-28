import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { usePlaylistStore } from '../stores/playlist'
import { useNavigationStore, type AppView } from '../stores/navigation'
import { useRecentPlaysStore } from '../stores/recent'
import { useProviderStore } from '../stores/providers'
import { useContentProvider } from '../hooks/useContentProvider'
import { useToastStore } from '../stores/toast'
import { useLikesStore } from '../stores/likes'
import { localMusicService } from '../lib/local-music-service'
import { providerAccountSession } from '../lib/provider-account-session'
import { runProviderTasks, type ProviderResult } from '../lib/content-hub'
import { providerFor } from '../providers/registry'
import { PROVIDER_IDS, type ProviderId } from '../providers/types'
import { PlaylistCard } from '../components/Explore/PlaylistCard'
import { PlaylistDetailView } from '../components/Playlist/PlaylistDetailView'
import { TrackRow } from '../components/Explore/TrackRow'
import { GradientText } from '../components/ui/GradientText'
import { ScrollArea } from '../components/ui/ScrollArea'
import { VirtualList } from '../components/ui/VirtualList'
import { SourceBadge } from '../components/ui/SourceBadge'
import type { Playlist, Track } from '../types/domain'
import type { MutableRefObject, RefObject } from 'react'
import styles from './LibraryPage.module.css'
import { LibraryToolbar } from '../components/ui/LibraryToolbar'
import { ActionButton } from '../components/ui/ActionButton'
import { CloseIcon } from '../components/ui/CloseIcon'
import { OfflineMusicTab } from './OfflineMusicTab'
import { AppPlaylistsTab } from './AppPlaylistsTab'
import { BatchTrackActions } from '../components/Playlist/BatchTrackActions'
import { SelectionCheck, SelectionMarquee } from '../components/Playlist/SelectionControls'
import { useMultiSelection } from '../hooks/useMultiSelection'
import { appPlaylistTrackKey } from '../stores/app-playlists'
import { getCachedProviderLibrary, loadProviderLibrary, type ProviderLibraryMode } from '../lib/provider-library'
import { supportsPlatformPlaylists } from '../lib/platform-playlists'
import { usePlatformPlaylistsStore } from '../stores/platform-playlists'
import { PlatformPlaylistNameDialog } from '../components/Playlist/PlatformPlaylistDialog'
import { LibraryTabs } from './LibraryTabs'
import { LIBRARY_TAB_ICONS } from './LibraryTabIcons'
import { CollectionKindSwitch, type CollectionKind } from './CollectionKindSwitch'
import { LibraryShelf, ShelfGrid, ShelfMessage, ShelfRefreshButton, ShelfSkeleton, ShelfCreateButton } from './LibraryShelf'
import { motion } from 'motion/react'
import { pageTransition } from '../lib/motion-presets'
import { usePageTransition } from '../hooks/useMotion'

type SubTab = 'app-playlists' | 'playlists' | 'favorites' | 'recent' | 'offline' | 'local'

const SUB_TABS: readonly SubTab[] = ['app-playlists', 'playlists', 'favorites', 'recent', 'offline', 'local']
const TAB_STORAGE_KEY = 'simplemusic-library-tab'

/** 读取用户上次选择的页签；缺失或无效时回到应用歌单。 */
function readStoredTab(): SubTab {
  try {
    const stored = typeof localStorage === 'undefined' ? null : localStorage.getItem(TAB_STORAGE_KEY)
    // 旧版独立的「专辑」页签已并入「收藏」。
    const value = stored === 'albums' ? 'favorites' : stored
    return SUB_TABS.includes(value as SubTab) ? value as SubTab : 'app-playlists'
  } catch {
    return 'app-playlists'
  }
}

function storeTab(tab: SubTab) {
  try { localStorage.setItem(TAB_STORAGE_KEY, tab) } catch { /* 存储不可用时仅本次生效 */ }
}

/** 本地音乐排序字段。name/artist 为字符串序,mtimeMs 为文件修改时间(近似添加时间)。 */
type LocalSortField = 'name' | 'artist' | 'mtimeMs'
type LocalSortDir = 'asc' | 'desc'

/** 56px 曲目行加 2px 行间距，与我的库原有列表尺寸一致。 */
const TRACK_ROW_HEIGHT = 58

const LOCAL_SORT_FIELDS: { field: LocalSortField; label: string }[] = [
  { field: 'name', label: '标题' },
  { field: 'artist', label: '艺人' },
  { field: 'mtimeMs', label: '添加时间' },
]

/** 本地曲目比较器:字符串字段按 localeCompare,时间字段按数值;缺省值排到末尾。 */
function compareTracks(a: Track, b: Track, field: LocalSortField, dir: LocalSortDir): number {
  let r: number
  if (field === 'mtimeMs') {
    const av = a.mtimeMs ?? 0
    const bv = b.mtimeMs ?? 0
    r = av - bv
  } else {
    const av = a[field] || ''
    const bv = b[field] || ''
    r = av.localeCompare(bv, 'zh-Hans-CN-u-co-pinyin')
  }
  return dir === 'asc' ? r : -r
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

export function LibraryPage({ detail = null }: { detail?: Extract<AppView, { type: 'playlist' }> | null } = {}) {
  const pageMotion = usePageTransition()
  // 伴奏入口跳来时首帧就停在应用歌单，不先闪一下上次的页签。
  const accompanimentsRequest = useNavigationStore(state => state.libraryAccompanimentsRequest)
  const [selectedTab, setSelectedTab] = useState<SubTab>(accompanimentsRequest ? 'app-playlists' : readStoredTab())
  const scrollRef = useRef<HTMLDivElement>(null)
  const { current: contentSource } = useContentProvider()
  const accountSession = contentSource ? providerAccountSession(contentSource) : 0
  const albumsAvailable = !!contentSource && !!providerFor(contentSource).library?.getUserAlbums
  const tab = selectedTab
  function selectTab(next: SubTab) {
    setSelectedTab(next)
    storeTab(next)
  }
  // 已在我的库时伴奏入口只发请求；请求由应用歌单页消费并切到伴奏。
  useEffect(() => {
    if (accompanimentsRequest && selectedTab !== 'app-playlists') selectTab('app-playlists')
  }, [accompanimentsRequest]) // eslint-disable-line react-hooks/exhaustive-deps

  if (detail) {
    return <PlaylistDetailView
      playlist={detail.playlist}
      initialTracks={detail.tracks}
      layoutIdPrefix={`library-cover-${detail.playlist.source}`}
    />
  }

  return (
    <ScrollArea className={styles.page} scrollRef={scrollRef} pauseCardEffects>
      <div className={styles.inner}>
      <div className={styles.header}>
        <h1 className={styles.pageTitle}><GradientText>我的库</GradientText></h1>
        <LibraryTabs<SubTab>
          value={tab}
          onChange={selectTab}
          items={SUB_TABS.map(value => ({
            value,
            icon: LIBRARY_TAB_ICONS[value],
            label: { 'app-playlists': '应用歌单', playlists: '歌单', favorites: '收藏', recent: '最近播放', offline: '离线音乐', local: '本地音乐' }[value],
          }))}
        />
      </div>

      <motion.div key={tab} initial={{ opacity: 0.75 }} animate={{ opacity: 1 }} transition={pageMotion(pageTransition)}>
      {tab === 'app-playlists' && <AppPlaylistsTab scrollRef={scrollRef} />}

      {tab === 'playlists' && (contentSource
        ? <ProviderLibraryGrid key={`${contentSource}:${accountSession}:playlists`} mode="playlists" source={contentSource} scrollRef={scrollRef} />
        : <OnlineLibraryUnavailable />)}

      {tab === 'favorites' && (contentSource
        ? <FavoritesTab key={`${contentSource}:${accountSession}`} source={contentSource} albumsAvailable={albumsAvailable} scrollRef={scrollRef} />
        : <OnlineLibraryUnavailable />)}

      {tab === 'recent' && <RecentPlaysList scrollRef={scrollRef} />}

      {tab === 'offline' && <OfflineMusicTab scrollRef={scrollRef} />}

      {tab === 'local' && <LocalMusicTab scrollRef={scrollRef} />}
      </motion.div>
      </div>
    </ScrollArea>
  )
}

const FAVORITES_KIND_STORAGE_KEY = 'simplemusic-library-favorites-kind'

function readStoredKind(): CollectionKind {
  try { return localStorage.getItem(FAVORITES_KIND_STORAGE_KEY) === 'albums' ? 'albums' : 'collected' } catch { return 'collected' }
}

/** 收藏：歌单与专辑二选一展示，选择跨会话记住；平台不支持专辑时只显示歌单。 */
function FavoritesTab({ source, albumsAvailable, scrollRef }: { source: ProviderId; albumsAvailable: boolean; scrollRef: RefObject<HTMLDivElement> }) {
  const pageMotion = usePageTransition()
  const [stored, setStored] = useState(readStoredKind)
  const kind: CollectionKind = albumsAvailable ? stored : 'collected'
  // 首次挂载已有外层 tab 淡入，内层不再叠一层整网格的淡入位移，只在切换歌单/专辑时播放。
  const switched = useRef(false)
  function select(next: CollectionKind) {
    switched.current = true
    setStored(next)
    try { localStorage.setItem(FAVORITES_KIND_STORAGE_KEY, next) } catch { /* 存储不可用时仅本次生效 */ }
  }
  return (
    <div className={styles.favorites}>
      {albumsAvailable && <CollectionKindSwitch value={kind} onChange={select} />}
      <motion.div key={kind} initial={switched.current ? { opacity: 0, y: 6 } : false} animate={{ opacity: 1, y: 0 }} transition={pageMotion(pageTransition)}>
        <ProviderLibraryGrid mode={kind} source={source} scrollRef={scrollRef} />
      </motion.div>
    </div>
  )
}

interface ProviderLibraryGridProps {
  mode: ProviderLibraryMode
  source: ProviderId
  scrollRef: RefObject<HTMLDivElement>
}

function cachedLibraryResult(source: ProviderId, mode: ProviderLibraryGridProps['mode']): Partial<Record<ProviderId, ProviderResult<Playlist[]>>> {
  const data = isProviderParticipating(source) ? getCachedProviderLibrary(source, mode) : undefined
  return data === undefined ? {} : { [source]: { source, status: data.length ? 'ready' : 'empty', data } }
}

function isProviderParticipating(source: ProviderId): boolean {
  const state = useProviderStore.getState().byId[source]
  return state.enabled && state.auth === 'authenticated' && state.playbackAvailable !== false
}

function OnlineLibraryUnavailable({ source }: { source?: ProviderId }) {
  const expiredSignature = useProviderStore((state) => PROVIDER_IDS
    .filter((id) => (!source || id === source) && state.byId[id].auth === 'expired')
    .join(','))
  const unavailableSignature = useProviderStore((state) => PROVIDER_IDS
    .filter((id) => (!source || id === source) && state.byId[id].auth === 'authenticated' && state.byId[id].playbackAvailable === false)
    .join(','))
  const labels = expiredSignature
    .split(',')
    .filter(Boolean)
    .map((id) => providerFor(id as ProviderId).descriptor.label)
  const unavailableLabels = unavailableSignature
    .split(',')
    .filter(Boolean)
    .map((id) => providerFor(id as ProviderId).descriptor.label)

  return (
    <div className={styles.emptyHint}>
      <p>{labels.length ? `${labels.join('、')}登录已失效` : unavailableLabels.length ? `${unavailableLabels.join('、')} 暂时不可用` : '没有已启用的在线音乐平台'}</p>
      {(labels.length > 0 || unavailableLabels.length > 0) && (
        <button type="button" onClick={() => useNavigationStore.getState().navigateTo('settings')}>{labels.length ? '前往设置重新登录' : '前往设置重新连接'}</button>
      )}
    </div>
  )
}

function ProviderLibraryGrid({ mode, source, scrollRef }: ProviderLibraryGridProps) {
  const [creating, setCreating] = useState(false)
  const managementRevision = usePlatformPlaylistsStore(state => source === 'netease' || source === 'qq' ? state.revision[source] : 0)
  const favoriteRevision = useLikesStore((state) => source === 'qq' && mode !== 'albums' ? state.qqMutationRevision : 0)
  const participating = useProviderStore((state) =>
    state.byId[source].enabled && state.byId[source].auth === 'authenticated' && state.byId[source].playbackAvailable !== false
  )
  const [results, setResults] = useState(() => cachedLibraryResult(source, mode))
  const sessionRef = useRef(0)
  const retryRef = useRef<Partial<Record<ProviderId, number>>>({})

  useEffect(() => {
    const session = ++sessionRef.current
    retryRef.current[source] = 0
    const controller = new AbortController()
    setResults((current) => participating ? { ...current, ...cachedLibraryResult(source, mode) } : {})
    void runProviderTasks(
      [source],
      (source) => loadProviderLibrary(source, mode),
      {
        signal: controller.signal,
        isEnabled: isProviderParticipating,
        isEmpty: (playlists) => playlists.length === 0,
        onUpdate: (result) => {
          if (session !== sessionRef.current || retryRef.current[source] !== 0) return
          setResults((current) => ({ ...current, [result.source]: { ...result, data: result.data ?? current[result.source]?.data ?? null } }))
        },
      }
    )
    return () => {
      sessionRef.current += 1
      controller.abort()
    }
  }, [mode, participating, source, favoriteRevision, managementRevision])

  function retryProvider(source: ProviderId, force = true): void {
    const session = sessionRef.current
    const retry = (retryRef.current[source] ?? 0) + 1
    retryRef.current[source] = retry
    void runProviderTasks(
      [source],
      (currentSource) => loadProviderLibrary(currentSource, mode, force),
      {
        isEnabled: isProviderParticipating,
        isEmpty: (playlists) => playlists.length === 0,
        onUpdate: (result) => {
          if (session !== sessionRef.current || retryRef.current[source] !== retry) return
          setResults((current) => ({ ...current, [result.source]: { ...result, data: result.data ?? current[result.source]?.data ?? null } }))
        },
      }
    )
  }

  useEffect(() => {
    if (!participating) return
    const onFocus = () => {
      if (useNavigationStore.getState().currentView === 'library') retryProvider(source, false)
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [mode, participating, source, favoriteRevision, managementRevision]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!participating) return <OnlineLibraryUnavailable source={source} />

  const result = results[source]
  const playlists = result?.data ?? []
  return <>
    {creating && supportsPlatformPlaylists(source) && <PlatformPlaylistNameDialog source={source} onClose={() => setCreating(false)} onCreated={(id, name) => {
      retryProvider(source)
      openPlaylist({ id, name, provider: source, source, type: 'playlist', cover: '', trackCount: 0, trackCountKnown: true, playCount: 0, creator: '' })
    }} />}
    <LibraryShelf label={`${providerFor(source).descriptor.label}音乐库`} identity={<SourceBadge source={source} displayMode="always" reveal />}
      actions={<>
        {mode === 'playlists' && supportsPlatformPlaylists(source) && <ShelfCreateButton onClick={() => setCreating(true)} />}
        {result && result.status !== 'error' && <ShelfRefreshButton refreshing={result.status === 'loading'} onClick={() => retryProvider(source)} />}
      </>}>
      {result?.status === 'error' && playlists.length === 0
        ? <ShelfMessage alert action={{ label: '重试', onClick: () => retryProvider(source) }}>这个平台暂时无法加载，请稍后重试。</ShelfMessage>
        : result?.status === 'empty'
          ? <ShelfMessage>{mode === 'albums' ? '还没有收藏的专辑' : mode === 'collected' ? '还没有收藏的歌单' : '这个平台暂时没有歌单，或需要先登录'}</ShelfMessage>
          : playlists.length > 0
            ? <ShelfGrid items={playlists} scrollRef={scrollRef} render={playlist => <PlaylistGridItem key={`${playlist.source}:${String(playlist.id)}`} playlist={playlist} />} />
            : <ShelfSkeleton />}
    </LibraryShelf>
  </>
}

/** 本地播放历史列表:点击整单入队从该曲播起。 */
function RecentPlaysList({ scrollRef }: { scrollRef: RefObject<HTMLDivElement> }) {
  const items = useRecentPlaysStore((s) => s.items)
  const queueRef = useRef<Track[]>([])
  queueRef.current = useMemo(() => items.map((r) => r.track), [items])

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
      <VirtualList
        total={items.length}
        rowHeight={TRACK_ROW_HEIGHT}
        scrollRef={scrollRef}
        renderRow={(index) => <QueuedTrackRow track={items[index].track} index={index} queueRef={queueRef} />}
      />
    </div>
  )
}

/** 本地音乐排序下拉:点击展开字段列表,选中后收起;旁边独立按钮切升降序。 */
function LocalSortMenu({
  field,
  dir,
  onChange,
}: {
  field: LocalSortField
  dir: LocalSortDir
  onChange: (field: LocalSortField, dir: LocalSortDir) => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const current = LOCAL_SORT_FIELDS.find((f) => f.field === field) ?? LOCAL_SORT_FIELDS[0]

  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className={styles.sortMenu} ref={rootRef}>
      <button
        type="button"
        className={`${styles.sortToggle} no-drag`}
        aria-label="本地音乐排序"
        title="排序方式"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={styles.sortValue}>{current.label}</span>
        <svg className={styles.sortCaret} data-open={open} width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
      </button>
      {open && (
        <div className={styles.sortDropdown} role="listbox">
          {LOCAL_SORT_FIELDS.map((f) => (
            <button
              key={f.field}
              type="button"
              role="option"
              aria-selected={f.field === field}
              className={`${styles.sortOption} no-drag${f.field === field ? ` ${styles.sortOptionActive}` : ''}`}
              onClick={() => {
                onChange(f.field, dir)
                setOpen(false)
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        className={`${styles.sortDirBtn} no-drag`}
        onClick={() => onChange(field, dir === 'asc' ? 'desc' : 'asc')}
        aria-label={dir === 'asc' ? '当前升序,点击改为降序' : '当前降序,点击改为升序'}
        title={dir === 'asc' ? '升序' : '降序'}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={dir === 'asc' ? 'M12 20V4m-5 5 5-5 5 5' : 'M12 4v16m-5-5 5 5 5-5'} /></svg>
      </button>
    </div>
  )
}

/** 本地音乐 tab:选文件夹批量导入,扁平列表播放;不接入在线音源的推荐/艺人体系。 */
function LocalMusicTab({ scrollRef }: { scrollRef: RefObject<HTMLDivElement> }) {
  const [folders, setFolders] = useState<string[]>([])
  const [tracks, setTracks] = useState<Track[]>([])
  const [keyword, setKeyword] = useState('')
  const [scanning, setScanning] = useState(false)
  const [sortField, setSortField] = useState<LocalSortField>('name')
  const [sortDir, setSortDir] = useState<LocalSortDir>('asc')
  const [selecting, setSelecting] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

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

  // 先过滤再排序:排序在搜索之后,确保显示顺序与当前排序一致。
  const sorted = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    const matched = kw
      ? tracks.filter((t) => t.name.toLowerCase().includes(kw) || t.artist.toLowerCase().includes(kw))
      : tracks
    return [...matched].sort((a, b) => compareTracks(a, b, sortField, sortDir))
  }, [tracks, keyword, sortField, sortDir])
  const queueRef = useRef<Track[]>([])
  queueRef.current = sorted
  const selection = useMultiSelection({
    enabled: selecting,
    keys: sorted.map(appPlaylistTrackKey),
    resetKey: `${keyword}:${sortField}:${sortDir}`,
    onExit: () => setSelecting(false),
    virtual: { listRef, rowHeight: TRACK_ROW_HEIGHT },
  })
  const selectedTracks = sorted.filter(track => selection.selected.has(appPlaylistTrackKey(track)))

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }, [scrollRef, keyword, sortField, sortDir])

  return (
    <div className={styles.trackList} ref={selection.rootRef} {...selection.surfaceProps}>
      <LibraryToolbar summary={keyword ? `${sorted.length} / ${tracks.length} 首` : `${tracks.length} 首`}
        primary={<ActionButton label="播放全部" icon="play" primary disabled={!sorted.length} onClick={() => usePlaylistStore.getState().setQueue(sorted, 0)} />}
        value={keyword} onChange={setKeyword} searchLabel="搜索本地音乐">
        <LocalSortMenu field={sortField} dir={sortDir} onChange={(f, d) => { setSortField(f); setSortDir(d) }} />
        <ActionButton label={scanning ? '导入中…' : '添加文件夹'} icon="folder" busy={scanning} onClick={() => void handleAddFolder()} />
        {!selecting && <BatchTrackActions compact tracks={sorted} label="当前本地音乐列表" menuLabel="本地音乐更多操作"
          onSelect={() => { setSelecting(true); selection.rootRef.current?.focus({ preventScroll: true }) }} />}
      </LibraryToolbar>

      {selecting && <BatchTrackActions tracks={selectedTracks} onDone={selection.clear}
        selection={{ total: sorted.length, onSelectAll: selection.selectAll, onClear: selection.clear, onExit: selection.exit }} />}

      {folders.length > 0 && (
        <div className={styles.folderList}>
          {folders.map((f) => (
            <span key={f} className={styles.folderChip}>
              <span title={f}>{f}</span>
              <button
                className={`${styles.folderChipRemove} no-drag`}
                onClick={() => void handleRemoveFolder(f)}
                aria-label={`从音乐库移除文件夹：${f}`}
                title="仅从音乐库移除，原文件保留"
              >
                <CloseIcon size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      {sorted.length === 0 ? (
        <div className={styles.emptyHint}>
          <p>{tracks.length === 0 ? '还没有导入本地音乐,点击「添加文件夹」开始' : '没有匹配的曲目'}</p>
        </div>
      ) : (
        <div ref={listRef}><VirtualList
          total={sorted.length}
          rowHeight={TRACK_ROW_HEIGHT}
          scrollRef={scrollRef}
          renderRow={(index) => {
            const track = sorted[index]
            const key = appPlaylistTrackKey(track)
            return selecting ? <div className={styles.selectableRow} key={key} data-selection-key={key} data-selected={selection.selected.has(key)}>
              <SelectionCheck label={`选择歌曲：${track.name}`} checked={selection.selected.has(key)} />
              <TrackRow track={track} index={index} hideLikeAction hideOfflineAction onPlay={() => {}} />
            </div> : <QueuedTrackRow track={track} index={index} queueRef={queueRef} />
          }}
        /></div>
      )}
      <SelectionMarquee rect={selection.marquee} />
    </div>
  )
}
