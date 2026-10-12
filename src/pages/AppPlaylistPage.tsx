import { useEffect, useMemo, useRef, useState } from 'react'
import { appPlaylistTrackKey, useAppPlaylistsStore } from '../stores/app-playlists'
import { useProviderStore } from '../stores/providers'
import { usePlaylistStore } from '../stores/playlist'
import { useOfflineCacheStore } from '../stores/offline-cache'
import { useNavigationStore } from '../stores/navigation'
import { useToastStore } from '../stores/toast'
import { localMusicService } from '../lib/local-music-service'
import { fetchOfflineStatuses, type OfflineCacheStatus } from '../lib/offline-cache'
import { appPlaylistPlaybackTracks, appPlaylistTrackState } from '../lib/app-playlist-playback'
import { TrackRow } from '../components/Explore/TrackRow'
import { AppPlaylistModal, AppPlaylistNameDialog } from '../components/Playlist/AppPlaylistDialog'
import { ScrollArea } from '../components/ui/ScrollArea'
import { VirtualList } from '../components/ui/VirtualList'
import type { Track } from '../types/domain'
import styles from './AppPlaylists.module.css'
import libraryStyles from './LibraryPage.module.css'

export function AppPlaylistPage({ id }: { id: string }) {
  const item = useAppPlaylistsStore(state => state.items.find(item => item.id === id))
  const archiveError = useAppPlaylistsStore(state => state.error)
  const providers = useProviderStore(state => state.byId)
  const offlineRevision = useOfflineCacheStore(state => state.revision)
  const [offlineSnapshot, setOfflineSnapshot] = useState<{ statuses: Record<string, OfflineCacheStatus>; revision: number }>({ statuses: {}, revision: -1 })
  const [offlineError, setOfflineError] = useState('')
  const [localTracks, setLocalTracks] = useState<Map<string, Track> | null>(null)
  const [localError, setLocalError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [editing, setEditing] = useState<'rename' | 'delete' | null>(null)
  const [error, setError] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const localIds = item?.tracks.filter(track => track.source === 'local').map(track => String(track.id)) ?? []
  const localSignature = JSON.stringify(localIds)

  useEffect(() => {
    if (!localIds.length) return
    const controller = new AbortController()
    setLocalTracks(null)
    setLocalError('')
    void localMusicService.getAvailableTracks(localIds, controller.signal).then(tracks => {
      if (!controller.signal.aborted) setLocalTracks(new Map(tracks.map(track => [String(track.id), track])))
    }).catch(() => { if (!controller.signal.aborted) setLocalError('本地索引读取失败') })
    return () => controller.abort()
  }, [localSignature, refresh])

  useEffect(() => {
    const controller = new AbortController()
    setOfflineSnapshot({ statuses: {}, revision: offlineRevision })
    setOfflineError('')
    if (item) void fetchOfflineStatuses(item.tracks, controller.signal).then(statuses => {
      if (!controller.signal.aborted) setOfflineSnapshot({ statuses: Object.fromEntries(statuses.map(status => [appPlaylistTrackKey(status), status])), revision: offlineRevision })
    }).catch(() => { if (!controller.signal.aborted) setOfflineError('离线状态读取失败，可刷新后重试') })
    return () => controller.abort()
  }, [item?.tracks, refresh, offlineRevision])

  // 完整查询是可用性依据；行徽标缓存有容量上限及迟到响应，不能覆盖它。
  // 保存、移除和 pin 变更通过 revision 触发重新查询。
  function currentOffline() {
    if (offlineSnapshot.revision !== useOfflineCacheStore.getState().revision) return {}
    return offlineSnapshot.statuses
  }
  const offline = useMemo(() => currentOffline(), [offlineSnapshot, offlineRevision])
  const context = { providers, localTracks, localError, offline }
  const rows = useMemo(() => item?.tracks.map(track => appPlaylistTrackState(track, context)) ?? [], [item?.tracks, providers, localTracks, localError, offline])
  const availableCount = rows.filter(row => row.available).length

  function edit(action: () => void) {
    try { action(); setError('') }
    catch (failure) { setError(failure instanceof Error ? failure.message : '保存失败，请重试') }
  }
  function playbackTracks() {
    return appPlaylistPlaybackTracks(item?.tracks ?? [], { ...context, providers: useProviderStore.getState().byId, offline: currentOffline() })
  }
  function play(key?: string) {
    const queue = playbackTracks()
    const index = key ? queue.findIndex(track => appPlaylistTrackKey(track) === key) : 0
    if (!queue.length || index < 0) { useToastStore.getState().show('当前没有可播放的歌曲'); return }
    usePlaylistStore.getState().setQueue(queue, index)
  }

  return <ScrollArea scrollRef={scrollRef}>
    <div className={libraryStyles.inner}>
      <button className={libraryStyles.clearBtn} onClick={() => useNavigationStore.getState().goBack()}>← 返回</button>
      {!item || archiveError ? <div className={styles.empty} role={archiveError ? 'alert' : undefined}><p>{archiveError || '这个应用歌单已被删除'}</p></div> : <>
        <header className={styles.detailHeader}>
          <div className={styles.detailCover} aria-hidden="true">♫</div>
          <div className={styles.identity}><span className={styles.eyebrow}>应用歌单</span><h1>{item.name}</h1><p className={styles.hint}>{item.tracks.length} 首歌曲 · 当前可播放 {availableCount} 首</p>
            <div className={styles.buttons}>
              <button className={styles.primary} disabled={!availableCount} onClick={() => play()}>播放全部</button>
              <button disabled={!availableCount} onClick={() => {
                const added = usePlaylistStore.getState().addManyToQueue(playbackTracks(), true)
                useToastStore.getState().show(added ? `已追加 ${added} 首到播放队列` : '播放队列已包含这些歌曲')
              }}>添加到播放队列</button>
              <button onClick={() => setEditing('rename')}>重命名</button>
              <button onClick={() => setEditing('delete')}>删除歌单</button>
            </div>
          </div>
        </header>
        <div className={styles.toolbar}><p className={styles.hint}>暂不可用的歌曲仍会保留。移除或排序后，下次播放采用新的歌单顺序。</p><button onClick={() => setRefresh(value => value + 1)}>刷新状态</button></div>
        {error && <p className={styles.error} role="alert">{error}</p>}
        {offlineError && <p className={styles.error} role="alert">{offlineError}</p>}
        {!item.tracks.length ? <div className={styles.empty}><p>歌单还是空的</p><span className={styles.hint}>从在线或本地音乐的更多操作中选择「加入应用歌单」。</span></div>
          : <VirtualList total={rows.length} rowHeight={58} scrollRef={scrollRef} renderRow={index => {
            const row = rows[index]
            const key = appPlaylistTrackKey(row.track)
            const title = row.track.name || `待加载歌曲 ${String(row.track.id)}`
            return <div className={styles.row} key={key}>
              <TrackRow track={{ ...row.track, name: title }} index={index} disabled={!row.available} statusLabel={row.status} showInactiveSource hideLikeAction onPlay={() => play(key)} />
              <div className={styles.rowActions}>
                <button disabled={index === 0} aria-label={`上移：${title}`} title="上移" onClick={() => edit(() => useAppPlaylistsStore.getState().moveTrack(id, key, -1))}>↑</button>
                <button disabled={index === rows.length - 1} aria-label={`下移：${title}`} title="下移" onClick={() => edit(() => useAppPlaylistsStore.getState().moveTrack(id, key, 1))}>↓</button>
                <button aria-label={`移出歌单：${title}`} title="移出歌单" onClick={() => edit(() => useAppPlaylistsStore.getState().removeTracks(id, [key]))}>×</button>
              </div>
            </div>
          }} />}
        {editing === 'rename' && <AppPlaylistNameDialog title="重命名应用歌单" initialName={item.name} onClose={() => setEditing(null)} onSubmit={name => useAppPlaylistsStore.getState().rename(id, name)} />}
        {editing === 'delete' && <AppPlaylistModal title="删除应用歌单" onClose={() => setEditing(null)}>
          <p className={styles.hint}>确定删除「{item.name}」？当前播放队列和歌曲文件会保留。</p>
          <div className={styles.buttons}><button autoFocus onClick={() => setEditing(null)}>取消</button><button onClick={() => edit(() => {
            useAppPlaylistsStore.getState().remove(id)
            setEditing(null)
            useNavigationStore.getState().goBack()
          })}>删除歌单</button></div>
          {error && <p className={styles.error} role="alert">{error}</p>}
        </AppPlaylistModal>}
      </>}
    </div>
  </ScrollArea>
}
