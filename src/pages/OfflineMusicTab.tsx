import { useTaskCenterStore } from '../stores/task-center'
import { useNavigationStore } from '../stores/navigation'
import { Select } from '../components/ui/Select'
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { LibraryToolbar } from '../components/ui/LibraryToolbar'
import { ActionButton } from '../components/ui/ActionButton'
import { HoverTips } from '../components/ui/HoverTips'
import { InfoButton } from '../components/ui/InfoButton'
import { TrackRow } from '../components/Explore/TrackRow'
import { VirtualList } from '../components/ui/VirtualList'
import { BatchTrackActions } from '../components/Playlist/BatchTrackActions'
import { SelectionCheck, SelectionMarquee } from '../components/Playlist/SelectionControls'
import { useMultiSelection } from '../hooks/useMultiSelection'
import { api } from '../lib/api'
import { deleteOfflineLibraryItems, fetchOfflineLibrary, filterOfflineLibrary, offlineLibraryTrack, type OfflineLibraryItem, type OfflineLibrarySort } from '../lib/offline-library'
import { offlineTrackKey } from '../lib/offline-cache'
import { useOfflineCacheStore } from '../stores/offline-cache'
import { usePlaylistStore } from '../stores/playlist'
import { useToastStore } from '../stores/toast'
import styles from './OfflineMusicTab.module.css'
import libraryStyles from './LibraryPage.module.css'

export function OfflineMusicTab({ scrollRef }: { scrollRef: RefObject<HTMLDivElement> }) {
  const [openingDirectory, setOpeningDirectory] = useState(false)
  async function openDirectory() {
    if (openingDirectory || !window.desktop?.openDirectory) return
    setOpeningDirectory(true)
    try {
      const dir = await useOfflineCacheStore.getState().loadDownloadDir()
      const result = await window.desktop.openDirectory(dir)
      if (!result.ok) useToastStore.getState().show('打开下载文件夹失败，请检查下载目录')
    } catch { useToastStore.getState().show('读取下载目录失败，请重试') }
    finally { if (mounted.current) setOpeningDirectory(false) }
  }
  const [items, setItems] = useState<OfflineLibraryItem[]>([])
  const [keyword, setKeyword] = useState('')
  const [sort, setSort] = useState<OfflineLibrarySort>('savedAt')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [removing, setRemoving] = useState<string | null>(null)
  const [selecting, setSelecting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const revision = useOfflineCacheStore((state) => state.revision)
  const mounted = useRef(false)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(false)
    void fetchOfflineLibrary(controller.signal).then((next) => {
      if (!controller.signal.aborted) setItems(next)
    }).catch(() => {
      if (!controller.signal.aborted) setError(true)
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    return () => controller.abort()
  }, [revision, refresh])

  async function remove(item: OfflineLibraryItem): Promise<void> {
    if (removing || deleting) return
    if (!window.confirm(`删除「${item.origin.name || '这首歌'}」的下载？歌曲文件会移到废纸篓。`)) return
    setRemoving(`${item.origin.source}:${item.origin.id}`)
    try {
      await api.post('/api/downloads/delete', { origin: item.origin, savedAt: item.savedAt })
      useToastStore.getState().show('已删除下载，歌曲文件已移到废纸篓')
    } catch {
      useToastStore.getState().show('删除下载失败，请刷新后重试')
    } finally {
      useOfflineCacheStore.getState().invalidate()
      if (mounted.current) setRemoving(null)
    }
  }

  const visible = useMemo(() => filterOfflineLibrary(items, keyword, sort), [items, keyword, sort])
  const queue = useMemo(() => visible.map(offlineLibraryTrack), [visible])
  const selection = useMultiSelection({
    enabled: selecting,
    keys: visible.map(item => offlineTrackKey(item.origin)),
    resetKey: `${keyword}:${sort}`,
    onExit: () => setSelecting(false),
    virtual: { listRef, rowHeight: 58 },
  })
  const selectedItems = visible.filter(item => selection.selected.has(offlineTrackKey(item.origin)))

  async function deleteSelected(signal: AbortSignal): Promise<void> {
    if (deleting || removing || !selectedItems.length) return
    if (!window.confirm(`删除所选 ${selectedItems.length} 首歌曲的下载？歌曲文件会移到废纸篓。`)) return
    setDeleting(true)
    try {
      const result = await deleteOfflineLibraryItems(selectedItems, signal)
      if (mounted.current) {
        const removed = new Set(result.removed.map(item => offlineTrackKey(item.origin)))
        setItems(current => current.filter(item => !removed.has(offlineTrackKey(item.origin))))
        useToastStore.getState().show(`已删除 ${result.removed.length} 首下载${result.failed.length ? `，${result.failed.length} 首未删除，请稍后重试` : result.cancelled ? '，剩余操作已取消' : ''}`)
      }
    } finally {
      // 取消中的请求也可能已在服务端完成，始终回查真实列表与缓存状态。
      useOfflineCacheStore.getState().invalidate()
      if (mounted.current) setDeleting(false)
    }
  }

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }, [scrollRef, keyword, sort])

  return (
    <div className={`${libraryStyles.trackList} ${styles.root}`} ref={selection.rootRef} {...selection.surfaceProps}>
      <HoverTips match="[data-icon-action], [data-tip-help]" exclude="[data-library-toolbar]" />
      <LibraryToolbar summary={keyword ? `${visible.length} / ${items.length} 首` : `${items.length} 首`}
        primary={<ActionButton label="播放全部" icon="play" primary disabled={loading || error || !queue.length} onClick={() => usePlaylistStore.getState().setQueue(queue, 0)} />}
        value={keyword} onChange={setKeyword} searchLabel="搜索已下载" placeholder="搜索歌曲、艺人或专辑" disabled={deleting}>
        <Select<OfflineLibrarySort> aria-label="已下载排序" value={sort} disabled={deleting} onChange={setSort}
          options={[{ value: 'savedAt', label: '最近下载' }, { value: 'name', label: '标题' }, { value: 'artist', label: '艺人' }]} />
        <ActionButton label="下载队列" icon="queue" iconOnly onClick={() => useTaskCenterStore.getState().show('download')} />
        <ActionButton label="刷新已下载" icon="refresh" iconOnly busy={loading} disabled={deleting} onClick={() => setRefresh(value => value + 1)} />
        {!selecting && <BatchTrackActions compact offline tracks={loading || error ? [] : queue} menuLabel="已下载更多操作"
          onSelect={() => { if (!removing) { setSelecting(true); selection.rootRef.current?.focus({ preventScroll: true }) } }} />}
        <ActionButton label="打开下载文件夹" icon="folder" iconOnly busy={openingDirectory}
          disabled={typeof window === 'undefined' || !window.desktop?.openDirectory} onClick={() => void openDirectory()} />
        <ActionButton label="下载设置" title="下载设置 · 下载目录与缓存" icon="settings" iconOnly onClick={() => {
          const navigation = useNavigationStore.getState()
          navigation.requestSettingsCache()
          navigation.navigateTo('settings')
        }} />
      </LibraryToolbar>
      <p className={styles.hint}>已下载的歌曲无需登录、断网也能播放。<InfoButton label="已下载" text="这里列出下载目录中的歌曲文件。删除下载会把文件移到废纸篓；在系统里直接删掉的文件会自动从这里消失。" align="left" /></p>
      {selecting && <BatchTrackActions offline tracks={selectedItems.map(offlineLibraryTrack)} onDone={selection.clear}
        onDelete={!loading && !error ? deleteSelected : undefined}
        selection={{ total: visible.length, onSelectAll: selection.selectAll, onClear: selection.clear, onExit: selection.exit }} />}
      {loading ? <div className={libraryStyles.emptyHint} role="status">加载中…</div>
        : error ? <div className={libraryStyles.emptyHint} role="alert"><p>已下载加载失败</p><button onClick={() => setRefresh((value) => value + 1)}>重试</button></div>
        : !visible.length ? <div className={libraryStyles.emptyHint}><p>{items.length ? '没有匹配的曲目' : '还没有下载的歌曲，在歌曲旁点击「下载歌曲」开始'}</p></div>
        : <div ref={listRef}><VirtualList total={visible.length} rowHeight={58} scrollRef={scrollRef} renderRow={(index) => {
          const item = visible[index]
          const key = offlineTrackKey(item.origin)
          if (selecting) return <div className={styles.selectableRow} key={key} data-selection-key={key} data-selected={selection.selected.has(key)}>
            <SelectionCheck label={`选择歌曲：${queue[index].name}`} checked={selection.selected.has(key)} />
            <TrackRow track={queue[index]} index={index} hideOfflineAction hideLikeAction onPlay={() => {}} />
          </div>
          return <div className={styles.row} key={key}>
            <TrackRow track={queue[index]} index={index} hideOfflineAction onPlay={() => usePlaylistStore.getState().setQueue(queue, index)} />
            <ActionButton label={`删除下载：${queue[index].name}`} icon="delete" iconOnly disabled={removing !== null} busy={removing === key} title="删除下载，歌曲文件移到废纸篓" onClick={() => void remove(item)} />
          </div>
        }} /></div>}
      <SelectionMarquee rect={selection.marquee} />
    </div>
  )
}
