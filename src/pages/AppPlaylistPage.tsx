import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { appPlaylistTrackKey, useAppPlaylistsStore } from '../stores/app-playlists'
import { useProviderStore } from '../stores/providers'
import { usePlaylistStore } from '../stores/playlist'
import { useOfflineCacheStore } from '../stores/offline-cache'
import { useNavigationStore } from '../stores/navigation'
import { useToastStore } from '../stores/toast'
import { useBackdropStore } from '../stores/backdrop'
import { AppPlaylistCover } from '../components/Playlist/AppPlaylistCover'
import { AppPlaylistSources } from '../components/Playlist/AppPlaylistSources'
import { localMusicService } from '../lib/local-music-service'
import { fetchOfflineStatuses, type OfflineCacheStatus } from '../lib/offline-cache'
import { appPlaylistPlaybackTracks, appPlaylistTrackState } from '../lib/app-playlist-playback'
import { TrackRow } from '../components/Explore/TrackRow'
import { AppPlaylistModal, AppPlaylistNameDialog } from '../components/Playlist/AppPlaylistDialog'
import { InfoButton } from '../components/ui/InfoButton'
import { ScrollArea } from '../components/ui/ScrollArea'
import { VirtualList } from '../components/ui/VirtualList'
import { TrackSearch } from '../components/ui/TrackSearch'
import { matchingTrackIndices } from '../lib/track-search'
import { useMultiSelection } from '../hooks/useMultiSelection'
import { BatchTrackActions } from '../components/Playlist/BatchTrackActions'
import { SelectionCheck, SelectionMarquee } from '../components/Playlist/SelectionControls'
import type { MusicSource, Track } from '../types/domain'
import styles from './AppPlaylists.module.css'
import playlistStyles from '../components/Playlist/PlaylistDetailView.module.css'
import actionStyles from '../components/Playlist/BatchTrackActions.module.css'
import { GradientText } from '../components/ui/GradientText'
import detailStyles from './AppPlaylistPage.module.css'
import { springGentle } from '../lib/motion-presets'
import { appPlaylistCoverLayoutId, appPlaylistCovers } from '../lib/app-playlist-presentation'

/** 与 VirtualList 行步长一致（56px 行 + 2px 间距）。 */
const ROW_HEIGHT = 58

type Mode = 'browse' | 'select' | 'reorder'

function DetailIcon({ kind }: { kind: 'back' | 'play' | 'queue' | 'refresh' | 'up' | 'down' | 'top' | 'bottom' | 'remove' }) {
  const paths = { back: 'm15 18-6-6 6-6',
    play: 'm9 5 11 7-11 7Z', queue: 'M4 6h16M4 12h10M4 18h10m4-3v6m-3-3h6', refresh: 'M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-2l2 3M4 16l2 3a7 7 0 0 0 12-2',
    up: 'm6 14 6-6 6 6', down: 'm6 10 6 6 6-6', top: 'M6 5h12M12 19V9m-5 5 5-5 5 5', bottom: 'M6 19h12M12 5v10m-5-5 5 5 5-5', remove: 'm6 6 12 12M6 18 18 6' }
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
  const [mode, setMode] = useState<Mode>('browse')
  const [query, setQuery] = useState('')
  const [sourceFilter, setSourceFilter] = useState<MusicSource | null>(null)
  const [onlyUnavailable, setOnlyUnavailable] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
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
  const unavailableCount = rows.length - availableCount
  const invalidKeys = rows.filter(row => row.invalid).map(row => appPlaylistTrackKey(row.track))
  const filtering = !!query.trim() || !!sourceFilter || onlyUnavailable
  // 调整顺序时展示完整列表，避免在筛选结果里移动造成位置错觉。
  const visible = useMemo(() => {
    if (mode === 'reorder') return rows.map((_, index) => index)
    const matched = query.trim() ? new Set(matchingTrackIndices(rows.map(row => row.track), query, true)) : null
    return rows.flatMap((row, index) => (matched && !matched.has(index))
      || (sourceFilter && row.track.source !== sourceFilter) || (onlyUnavailable && row.available) ? [] : [index])
  }, [rows, mode, query, sourceFilter, onlyUnavailable])
  const visibleKeys = visible.map(index => appPlaylistTrackKey(rows[index].track))
  const selection = useMultiSelection({
    enabled: mode === 'select',
    keys: visibleKeys,
    resetKey: `${id}:${query}:${sourceFilter}:${onlyUnavailable}`,
    onExit: () => setMode('browse'),
    virtual: { listRef, rowHeight: ROW_HEIGHT },
  })
  const selectedRows = mode === 'select' ? visible.map(index => rows[index]).filter(row => selection.selected.has(appPlaylistTrackKey(row.track))) : []
  const backdropCover = useMemo(() => appPlaylistCovers(item?.tracks ?? [])[0]?.url ?? '', [item?.tracks])

  // 歌单封面模糊后作为全局背景，与平台歌单详情一致；离开详情页时清空。
  useEffect(() => useBackdropStore.getState().setCover(backdropCover), [backdropCover])
  // 歌单被清空或筛选来源已无歌曲时自动解除对应筛选。
  useEffect(() => {
    if (sourceFilter && !rows.some(row => row.track.source === sourceFilter)) setSourceFilter(null)
    if (onlyUnavailable && !unavailableCount) setOnlyUnavailable(false)
  }, [rows, sourceFilter, onlyUnavailable, unavailableCount])

  function enterMode(next: Mode) {
    if (managementRef.current) managementRef.current.open = false
    if (next === 'reorder') { setQuery(''); setSourceFilter(null); setOnlyUnavailable(false) }
    setMode(next)
    if (next === 'select') requestAnimationFrame(() => selection.rootRef.current?.focus({ preventScroll: true }))
  }
  function clearFilters() { setQuery(''); setSourceFilter(null); setOnlyUnavailable(false) }
  async function removeSelected() {
    const keys = selectedRows.map(row => appPlaylistTrackKey(row.track))
    if (!keys.length || !window.confirm(`从「${item?.name ?? '应用歌单'}」移出选中的 ${keys.length} 首歌曲？平台歌单和本地文件不受影响。`)) return
    edit(() => useAppPlaylistsStore.getState().removeTracks(id, keys))
    selection.clear()
    useToastStore.getState().show(`已移出 ${keys.length} 首歌曲`)
  }
  function removeInvalid() {
    if (!invalidKeys.length || !window.confirm(`移出 ${invalidKeys.length} 首已失效的歌曲？平台歌单和本地文件不受影响。`)) return
    edit(() => useAppPlaylistsStore.getState().removeTracks(id, invalidKeys))
    useToastStore.getState().show(`已移出 ${invalidKeys.length} 首已失效歌曲`)
  }

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

  function renderRow(position: number): ReactNode {
    const index = visible[position]
    const row = rows[index]
    if (!row) return null
    const key = appPlaylistTrackKey(row.track)
    const title = row.track.name || `待加载歌曲 ${String(row.track.id)}`
    const track = { ...row.track, name: title }
    if (mode === 'select') {
      const checked = selection.selected.has(key)
      return <div className={playlistStyles.selectableRow} key={key} data-selected={checked} data-selection-key={key} data-unavailable={!row.available}>
        <SelectionCheck label={`选择歌曲：${title}`} checked={checked} />
        <TrackRow track={track} index={position} disabled={!row.available} statusLabel={row.status} showInactiveSource hideLikeAction hideOfflineAction onPlay={() => {}} />
      </div>
    }
    if (mode === 'reorder') {
      const last = rows.length - 1
      const move = (target: number) => edit(() => useAppPlaylistsStore.getState().moveTrackTo(id, key, target))
      return <div className={`${styles.row} ${detailStyles.row} ${detailStyles.reorderRow}`} key={key}>
        <TrackRow track={track} index={index} disabled={!row.available} statusLabel={row.status} showInactiveSource hideLikeAction hideOfflineAction onPlay={() => play(key)} />
        <div className={`${styles.rowActions} ${detailStyles.reorderActions}`}>
          <button disabled={index === 0} aria-label={`移到最前：${title}`} title="移到最前" onClick={() => move(0)}><DetailIcon kind="top" /></button>
          <button disabled={index === 0} aria-label={`上移：${title}`} title="上移" onClick={() => move(index - 1)}><DetailIcon kind="up" /></button>
          <button disabled={index === last} aria-label={`下移：${title}`} title="下移" onClick={() => move(index + 1)}><DetailIcon kind="down" /></button>
          <button disabled={index === last} aria-label={`移到最后：${title}`} title="移到最后" onClick={() => move(last)}><DetailIcon kind="bottom" /></button>
        </div>
      </div>
    }
    return <div className={`${styles.row} ${detailStyles.row}`} key={key}>
      <TrackRow track={track} index={position} disabled={!row.available} statusLabel={row.status} showInactiveSource hideLikeAction onPlay={() => play(key)} />
      <div className={`${styles.rowActions} ${detailStyles.rowActions}`}>
        <button aria-label={`移出歌单：${title}`} title="移出歌单" onClick={() => edit(() => useAppPlaylistsStore.getState().removeTracks(id, [key]))}><DetailIcon kind="remove" /></button>
      </div>
    </div>
  }

  return <ScrollArea scrollRef={scrollRef}>
    <div className={`${playlistStyles.inner} ${detailStyles.page}`} ref={selection.rootRef} {...selection.surfaceProps}>
      <button className={`${playlistStyles.backBtn} no-drag`} onClick={() => useNavigationStore.getState().goBack()}><DetailIcon kind="back" />返回</button>
      {!item || archiveError ? <div className={styles.empty} role={archiveError ? 'alert' : undefined}><p>{archiveError || '这个应用歌单已被删除'}</p></div> : <>
        <header className={playlistStyles.detailHeader}>
          <div className={playlistStyles.detailMeta}>
            <motion.div className={playlistStyles.detailCover} layoutId={appPlaylistCoverLayoutId(item.id)} layoutCrossfade={false}
              transition={springGentle} style={{ borderRadius: 12 }}>
              <AppPlaylistCover tracks={item.tracks} />
            </motion.div>
            <div className={playlistStyles.detailInfo}>
              <div className={playlistStyles.titleRow}>
                <h1 className={playlistStyles.detailTitle}><GradientText>{item.name}</GradientText></h1>
                <details className={actionStyles.compact} ref={managementRef}
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
                  <summary className={`${actionStyles.more} ${detailStyles.more} no-drag`} aria-label="歌单更多操作"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg></summary>
                  <div className={actionStyles.menu} role="group" aria-label="管理应用歌单">
                    <button type="button" disabled={!item.tracks.length} onClick={() => enterMode('select')}>多选歌曲</button>
                    <button type="button" disabled={item.tracks.length < 2} onClick={() => enterMode('reorder')}>调整顺序</button>
                    <span className={detailStyles.menuDivider} aria-hidden="true" />
                    <button type="button" onClick={() => openEditor('rename')}>重命名</button>
                    <button type="button" className={detailStyles.danger} onClick={() => openEditor('delete')}>删除歌单</button>
                  </div>
                </details>
              </div>
              <p className={playlistStyles.detailSub}>应用歌单 · {item.tracks.length} 首歌曲 · 当前可播放 {availableCount} 首</p>
              <div className={`${styles.buttons} ${detailStyles.actions}`}>
                <button className={styles.primary} disabled={!availableCount} onClick={() => play()}><DetailIcon kind="play" />播放全部</button>
                <button disabled={!availableCount} onClick={async () => {
                  try {
                    const added = await usePlaylistStore.getState().addManyToQueue(playbackTracks(), true)
                    useToastStore.getState().show(added ? `已追加 ${added} 首到播放队列` : '播放队列已包含这些歌曲')
                  } catch { /* 播放客户端已显示失败原因。 */ }
                }}><DetailIcon kind="queue" />添加到播放队列</button>
              </div>
            </div>
          </div>
        </header>
        {item.tracks.length > 0 && mode !== 'reorder' && <div className={detailStyles.filters}>
          <AppPlaylistSources tracks={item.tracks} selected={sourceFilter} onSelect={setSourceFilter} />
          {unavailableCount > 0 && <button type="button" className={`${detailStyles.unavailableChip} no-drag`} aria-pressed={onlyUnavailable}
            title={onlyUnavailable ? '显示全部歌曲' : '只看暂不可播放的歌曲'} onClick={() => setOnlyUnavailable(value => !value)}>
            <span className={detailStyles.unavailableDot} aria-hidden="true" />{unavailableCount} 首不可播放
          </button>}
        </div>}
        {item.tracks.length > 0 && mode !== 'reorder' && onlyUnavailable && <div className={detailStyles.notice} role="status">
          <p>{invalidKeys.length
            ? `其中 ${invalidKeys.length} 首已失效（本地文件不存在或曲目下架）${unavailableCount > invalidKeys.length ? '，其余重新登录或启用平台后即可恢复' : ''}。`
            : '这些歌曲在重新登录或启用对应平台后即可恢复，无需移出。'}</p>
          {invalidKeys.length > 0 && <button type="button" className={`${detailStyles.noticeAction} no-drag`} onClick={removeInvalid}>移出 {invalidKeys.length} 首已失效歌曲</button>}
        </div>}
        {mode === 'select' && <BatchTrackActions tracks={selectedRows.map(row => row.track)} onDone={selection.clear} onRemove={removeSelected} removeLabel="移出应用歌单"
          selection={{ total: visible.length, onSelectAll: selection.selectAll, onClear: selection.clear, onExit: selection.exit }} />}
        {mode === 'reorder' ? <div className={detailStyles.reorderBar} role="region" aria-label="调整顺序">
          <div><strong>调整顺序</strong><span>改动立即保存，下次播放按新顺序。</span></div>
          <button type="button" className={`${styles.primary} no-drag`} onClick={() => setMode('browse')}>完成</button>
        </div> : item.tracks.length > 0 && <TrackSearch value={query} onChange={setQuery} placeholder="搜索歌单内的歌曲或歌手" count={visible.length}>
          <div className={detailStyles.listTitle}>
            <h2>歌曲</h2><span>{filtering ? `${visible.length} / ${item.tracks.length}` : item.tracks.length}</span>
            <InfoButton label="应用歌单说明" text="可收藏网易云、QQ、Apple Music 和本地歌曲。整理只影响应用歌单，不会修改平台歌单；暂不可用的歌曲仍会保留。" align="left" />
            <button className={`${playlistStyles.refreshBtn} ${detailStyles.refresh} no-drag`} onClick={() => setRefresh(value => value + 1)}><DetailIcon kind="refresh" />刷新状态</button>
          </div>
        </TrackSearch>}
        {error && <p className={styles.error} role="alert">{error}</p>}
        {offlineError && <p className={styles.error} role="alert">{offlineError}</p>}
        {!item.tracks.length ? <div className={styles.empty}><p>把喜欢的歌放进来</p><span className={styles.hint}>在歌曲上点「＋」或右键，正在播放的歌可在播放栏加入；整张专辑或歌单从「更多」中加入。</span></div>
          : !visible.length ? <div className={styles.empty}><p>没有符合条件的歌曲</p><button className="no-drag" onClick={clearFilters}>清除筛选</button></div>
          : <div className={detailStyles.trackList} ref={listRef}><VirtualList total={visible.length} rowHeight={ROW_HEIGHT} scrollRef={scrollRef} renderRow={renderRow} /></div>}
        {editing === 'rename' && <AppPlaylistNameDialog title="重命名应用歌单" initialName={item.name} onClose={closeEditor} onSubmit={name => useAppPlaylistsStore.getState().rename(id, name)} />}
        {editing === 'delete' && <AppPlaylistModal title="删除应用歌单" onClose={closeEditor}>
          <p className={styles.hint}>确定删除「{item.name}」？当前播放队列和歌曲文件会保留。</p>
          <div className={styles.buttons}><button autoFocus onClick={closeEditor}>取消</button><button className={styles.danger} onClick={() => edit(() => {
            useAppPlaylistsStore.getState().remove(id)
            setEditing(null)
            useNavigationStore.getState().goBack()
          })}>删除歌单</button></div>
          {error && <p className={styles.error} role="alert">{error}</p>}
        </AppPlaylistModal>}
      </>}
    </div>
    <SelectionMarquee rect={selection.marquee} />
  </ScrollArea>
}
