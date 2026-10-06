import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
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
    const key = `${item.origin.source}:${item.origin.id}`
    setRemoving(key)
    try {
      await api.post('/api/audio-cache/pin', { entryId: item.entryId, origin: item.origin, pinned: false })
      useOfflineCacheStore.getState().invalidate()
      useToastStore.getState().show('已移除离线保存，音频保留为临时缓存')
    } catch {
      useToastStore.getState().show('移除失败，请刷新后重试')
    } finally {
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
    if (!window.confirm(`删除所选 ${selectedItems.length} 首离线音乐？不再被其他离线歌曲共用的音频会一并删除，下载目录中的歌曲文件保留。`)) return
    setDeleting(true)
    try {
      const result = await deleteOfflineLibraryItems(selectedItems, signal)
      if (mounted.current) {
        const removed = new Set(result.removed.map(item => offlineTrackKey(item.origin)))
        setItems(current => current.filter(item => !removed.has(offlineTrackKey(item.origin))))
        useToastStore.getState().show(`已删除 ${result.removed.length} 首离线音乐${result.failed.length ? `，${result.failed.length} 首未删除，请稍后重试` : result.cancelled ? '，剩余操作已取消' : ''}`)
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
      <div className={styles.toolbar}>
        <span className={libraryStyles.trackListCount}>{visible.length} / {items.length} 首</span>
        <div className={styles.actions}>
          <input className={libraryStyles.searchInput} aria-label="搜索离线音乐" placeholder="搜索歌曲、艺人或专辑" value={keyword} disabled={deleting} onChange={(event) => setKeyword(event.target.value)} />
          <select className={styles.sort} aria-label="离线音乐排序" value={sort} disabled={deleting} onChange={(event) => setSort(event.target.value as OfflineLibrarySort)}>
            <option value="savedAt">最近保存</option>
            <option value="name">标题</option>
            <option value="artist">艺人</option>
          </select>
          <button className={`${libraryStyles.clearBtn} no-drag`} disabled={loading || deleting} onClick={() => setRefresh((value) => value + 1)}>刷新</button>
          <button className={`${libraryStyles.clearBtn} no-drag`} disabled={loading || error || !queue.length} onClick={() => usePlaylistStore.getState().setQueue(queue, 0)}>播放全部</button>
          {!selecting && <BatchTrackActions compact offline tracks={loading || error ? [] : queue} menuLabel="离线音乐更多操作"
            onSelect={() => { if (!removing) { setSelecting(true); selection.rootRef.current?.focus({ preventScroll: true }) } }} />}
        </div>
      </div>
      <p className={styles.hint}>已保存歌曲无需登录即可播放。移除保存后转为临时缓存；批量删除会清理未共用的离线音频，保留独立下载文件。</p>
      {selecting && <BatchTrackActions offline tracks={selectedItems.map(offlineLibraryTrack)} onDone={selection.clear}
        onDelete={!loading && !error ? deleteSelected : undefined}
        selection={{ total: visible.length, onSelectAll: selection.selectAll, onClear: selection.clear, onExit: selection.exit }} />}
      {loading ? <div className={libraryStyles.emptyHint} role="status">加载中…</div>
        : error ? <div className={libraryStyles.emptyHint} role="alert"><p>离线音乐加载失败</p><button onClick={() => setRefresh((value) => value + 1)}>重试</button></div>
        : !visible.length ? <div className={libraryStyles.emptyHint}><p>{items.length ? '没有匹配的曲目' : '还没有离线音乐，在歌曲旁点击「保存到本地」开始'}</p></div>
        : <div ref={listRef}><VirtualList total={visible.length} rowHeight={58} scrollRef={scrollRef} renderRow={(index) => {
          const item = visible[index]
          const key = offlineTrackKey(item.origin)
          if (selecting) return <div className={styles.selectableRow} key={key} data-selection-key={key} data-selected={selection.selected.has(key)}>
            <SelectionCheck label={`选择歌曲：${queue[index].name}`} checked={selection.selected.has(key)} />
            <TrackRow track={queue[index]} index={index} hideOfflineAction hideLikeAction onPlay={() => {}} />
          </div>
          return <div className={styles.row} key={key}>
            <TrackRow track={queue[index]} index={index} hideOfflineAction onPlay={() => usePlaylistStore.getState().setQueue(queue, index)} />
            <button className={`${libraryStyles.clearBtn} no-drag`} disabled={removing !== null} aria-label={`移除离线保存：${queue[index].name}`} onClick={() => void remove(item)}>{removing === key ? '移除中…' : '移除保存'}</button>
          </div>
        }} /></div>}
      <SelectionMarquee rect={selection.marquee} />
    </div>
  )
}
