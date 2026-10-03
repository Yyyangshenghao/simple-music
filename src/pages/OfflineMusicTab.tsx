import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { TrackRow } from '../components/Explore/TrackRow'
import { VirtualList } from '../components/ui/VirtualList'
import { api } from '../lib/api'
import { fetchOfflineLibrary, filterOfflineLibrary, offlineLibraryTrack, type OfflineLibraryItem, type OfflineLibrarySort } from '../lib/offline-library'
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
    if (removing) return
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

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }, [scrollRef, keyword, sort])

  return (
    <div className={libraryStyles.trackList}>
      <div className={styles.toolbar}>
        <span className={libraryStyles.trackListCount}>{visible.length} / {items.length} 首</span>
        <div className={styles.actions}>
          <input className={libraryStyles.searchInput} aria-label="搜索离线音乐" placeholder="搜索歌曲、艺人或专辑" value={keyword} onChange={(event) => setKeyword(event.target.value)} />
          <select className={styles.sort} aria-label="离线音乐排序" value={sort} onChange={(event) => setSort(event.target.value as OfflineLibrarySort)}>
            <option value="savedAt">最近保存</option>
            <option value="name">标题</option>
            <option value="artist">艺人</option>
          </select>
          <button className={`${libraryStyles.clearBtn} no-drag`} disabled={loading} onClick={() => setRefresh((value) => value + 1)}>刷新</button>
          <button className={`${libraryStyles.clearBtn} no-drag`} disabled={loading || error || !queue.length} onClick={() => usePlaylistStore.getState().setQueue(queue, 0)}>播放全部</button>
        </div>
      </div>
      <p className={styles.hint}>已保存歌曲无需登录即可播放。移除保存后，音频将作为临时缓存参与自动清理。</p>
      {loading ? <div className={libraryStyles.emptyHint} role="status">加载中…</div>
        : error ? <div className={libraryStyles.emptyHint} role="alert"><p>离线音乐加载失败</p><button onClick={() => setRefresh((value) => value + 1)}>重试</button></div>
        : !visible.length ? <div className={libraryStyles.emptyHint}><p>{items.length ? '没有匹配的曲目' : '还没有离线音乐，在歌曲旁点击「保存到本地」开始'}</p></div>
        : <VirtualList total={visible.length} rowHeight={58} scrollRef={scrollRef} renderRow={(index) => {
          const item = visible[index]
          const key = `${item.origin.source}:${item.origin.id}`
          return <div className={styles.row} key={key}>
            <TrackRow track={queue[index]} index={index} hideOfflineAction onPlay={() => usePlaylistStore.getState().setQueue(queue, index)} />
            <button className={`${libraryStyles.clearBtn} no-drag`} disabled={removing !== null} aria-label={`移除离线保存：${queue[index].name}`} onClick={() => void remove(item)}>{removing === key ? '移除中…' : '移除保存'}</button>
          </div>
        }} />}
    </div>
  )
}
