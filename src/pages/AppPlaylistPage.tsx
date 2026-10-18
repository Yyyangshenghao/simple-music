import { useEffect, useMemo, useRef, useState } from 'react'
import { appPlaylistTrackKey, useAppPlaylistsStore } from '../stores/app-playlists'
import { useProviderStore } from '../stores/providers'
import { usePlaylistStore } from '../stores/playlist'
import { useOfflineCacheStore } from '../stores/offline-cache'
import { useNavigationStore } from '../stores/navigation'
import { useToastStore } from '../stores/toast'
import { sizedImage } from '../lib/image-size'
import { localMusicService } from '../lib/local-music-service'
import { fetchOfflineStatuses, type OfflineCacheStatus } from '../lib/offline-cache'
import { appPlaylistPlaybackTracks, appPlaylistTrackState } from '../lib/app-playlist-playback'
import { TrackRow } from '../components/Explore/TrackRow'
import { AppPlaylistModal, AppPlaylistNameDialog } from '../components/Playlist/AppPlaylistDialog'
import { AppPlaylistSync } from '../components/Playlist/AppPlaylistSync'
import { InfoButton } from '../components/ui/InfoButton'
import { ScrollArea } from '../components/ui/ScrollArea'
import { VirtualList } from '../components/ui/VirtualList'
import type { Track } from '../types/domain'
import styles from './AppPlaylists.module.css'
import libraryStyles from './LibraryPage.module.css'
import detailStyles from './AppPlaylistPage.module.css'

function DetailIcon({ kind }: { kind: 'back' | 'music' | 'play' | 'queue' | 'refresh' | 'up' | 'down' | 'remove' | 'sync' }) {
  const paths = { back: 'm15 18-6-6 6-6', music: 'M9 18V5l12-2v13M9 8l12-2M9 18a3 3 0 1 1-3-3c1.7 0 3 1.3 3 3Zm12-2a3 3 0 1 1-3-3c1.7 0 3 1.3 3 3Z',
    play: 'm9 5 11 7-11 7Z', queue: 'M4 6h16M4 12h10M4 18h10m4-3v6m-3-3h6', refresh: 'M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-2l2 3M4 16l2 3a7 7 0 0 0 12-2',
    up: 'm6 14 6-6 6 6', down: 'm6 10 6 6 6-6', remove: 'm6 6 12 12M6 18 18 6', sync: 'm16 3 4 4-4 4M4 7h16M8 21l-4-4 4-4m12 4H4' }
  return <svg width="16" height="16" viewBox="0 0 24 24" fill={kind === 'play' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[kind]} /></svg>
}

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
  const managementRef = useRef<HTMLDetailsElement>(null)
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
  const covers = [...new Set(rows.map(row => row.track.cover).filter((cover): cover is string => !!cover))].slice(0, 4)

  function openEditor(action: 'rename' | 'delete') {
    if (managementRef.current) {
      managementRef.current.open = false
      managementRef.current.querySelector('summary')?.focus()
    }
    setEditing(action)
  }

  function closeEditor() {
    setEditing(null)
    requestAnimationFrame(() => managementRef.current?.querySelector('summary')?.focus())
  }

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
    <div className={`${libraryStyles.inner} ${detailStyles.page}`}>
      <button className={`${detailStyles.back} no-drag`} onClick={() => useNavigationStore.getState().goBack()}><DetailIcon kind="back" />返回</button>
      {!item || archiveError ? <div className={styles.empty} role={archiveError ? 'alert' : undefined}><p>{archiveError || '这个应用歌单已被删除'}</p></div> : <>
        <header className={detailStyles.header}>
          <div className={detailStyles.cover} data-mosaic={covers.length === 4} aria-hidden="true">
            <span className={detailStyles.coverFallback}><DetailIcon kind="music" /></span>
            {(covers.length === 4 ? covers : covers.slice(0, 1)).map(cover => <img key={cover} src={sizedImage(cover, 384)} alt="" onError={event => { event.currentTarget.style.visibility = 'hidden' }} />)}
          </div>
          <div className={detailStyles.identity}><h1>{item.name}</h1><p className={detailStyles.meta}><span>应用歌单</span><span>{item.tracks.length} 首歌曲</span><span>当前可播放 {availableCount} 首</span></p>
            <div className={styles.buttons}>
              <button className={styles.primary} disabled={!availableCount} onClick={() => play()}><DetailIcon kind="play" />播放全部</button>
              <button disabled={!availableCount} onClick={async () => {
                try {
                  const added = await usePlaylistStore.getState().addManyToQueue(playbackTracks(), true)
                  useToastStore.getState().show(added ? `已追加 ${added} 首到播放队列` : '播放队列已包含这些歌曲')
                } catch { /* 播放客户端已显示失败原因。 */ }
              }}><DetailIcon kind="queue" />添加到播放队列</button>
              <details className={styles.management} ref={managementRef}
                onBlur={event => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) event.currentTarget.open = false
                }}
                onKeyDown={event => {
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    event.stopPropagation()
                    event.currentTarget.open = false
                    event.currentTarget.querySelector('summary')?.focus()
                  }
                }}>
                <summary className="no-drag" aria-label="歌单更多操作">更多<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg></summary>
                <div className={styles.managementPanel} role="group" aria-label="管理应用歌单">
                  <button type="button" onClick={() => openEditor('rename')}>重命名</button>
                  <button type="button" className={styles.danger} onClick={() => openEditor('delete')}>删除歌单</button>
                </div>
              </details>
            </div>
          </div>
        </header>
        <section className={detailStyles.sync} aria-label="云端同步"><h2><DetailIcon kind="sync" />云端同步</h2><div className={detailStyles.syncContent}><AppPlaylistSync item={item} /></div></section>
        <div className={detailStyles.listToolbar}>
          <div className={detailStyles.listTitle}><h2>歌曲</h2><span>{item.tracks.length}</span><InfoButton label="歌单排序与移除" text="暂不可用的歌曲仍会保留。移除或排序后，下次播放采用新的歌单顺序。" align="left" /></div>
          <button className={detailStyles.refresh} onClick={() => setRefresh(value => value + 1)}><DetailIcon kind="refresh" />刷新状态</button>
        </div>
        {error && <p className={styles.error} role="alert">{error}</p>}
        {offlineError && <p className={styles.error} role="alert">{offlineError}</p>}
        {!item.tracks.length ? <div className={styles.empty}><p>歌单还是空的</p><span className={styles.hint}>从在线或本地音乐的更多操作中选择「加入应用歌单」。</span></div>
          : <div className={detailStyles.trackList}><VirtualList total={rows.length} rowHeight={58} scrollRef={scrollRef} renderRow={index => {
            const row = rows[index]
            const key = appPlaylistTrackKey(row.track)
            const title = row.track.name || `待加载歌曲 ${String(row.track.id)}`
            return <div className={`${styles.row} ${detailStyles.row}`} key={key}>
              <TrackRow track={{ ...row.track, name: title }} index={index} disabled={!row.available} statusLabel={row.status} showInactiveSource hideLikeAction onPlay={() => play(key)} />
              <div className={`${styles.rowActions} ${detailStyles.rowActions}`}>
                <button disabled={index === 0} aria-label={`上移：${title}`} title="上移" onClick={() => edit(() => useAppPlaylistsStore.getState().moveTrack(id, key, -1))}><DetailIcon kind="up" /></button>
                <button disabled={index === rows.length - 1} aria-label={`下移：${title}`} title="下移" onClick={() => edit(() => useAppPlaylistsStore.getState().moveTrack(id, key, 1))}><DetailIcon kind="down" /></button>
                <button aria-label={`移出歌单：${title}`} title="移出歌单" onClick={() => edit(() => useAppPlaylistsStore.getState().removeTracks(id, [key]))}><DetailIcon kind="remove" /></button>
              </div>
            </div>
          }} /></div>}
        {editing === 'rename' && <AppPlaylistNameDialog title="重命名应用歌单" initialName={item.name} onClose={closeEditor} onSubmit={name => useAppPlaylistsStore.getState().rename(id, name)} />}
        {editing === 'delete' && <AppPlaylistModal title="删除应用歌单" onClose={closeEditor}>
          <p className={styles.hint}>确定删除「{item.name}」？当前播放队列、歌曲文件和已同步的云端歌单会保留。</p>
          <div className={styles.buttons}><button autoFocus onClick={closeEditor}>取消</button><button className={styles.danger} onClick={() => edit(() => {
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
