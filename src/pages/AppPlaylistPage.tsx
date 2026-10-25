import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { appPlaylistTrackKey, useAppPlaylistsStore } from '../stores/app-playlists'
import { useProviderStore } from '../stores/providers'
import { usePlaylistStore } from '../stores/playlist'
import { useSettingsStore } from '../stores/settings'
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
import { TRACK_ROW_HEIGHT } from '../components/Playlist/PlaylistDetailView'
import { AppPlaylistModal, AppPlaylistNameDialog } from '../components/Playlist/AppPlaylistDialog'
import { VirtualList } from '../components/ui/VirtualList'
import { TrackSearch } from '../components/ui/TrackSearch'
import { matchingTrackIndices } from '../lib/track-search'
import { useMultiSelection } from '../hooks/useMultiSelection'
import { BatchTrackActions } from '../components/Playlist/BatchTrackActions'
import { SelectionCheck, SelectionMarquee } from '../components/Playlist/SelectionControls'
import type { MusicSource, Track } from '../types/domain'
import styles from './AppPlaylists.module.css'
import playlistStyles from '../components/Playlist/PlaylistDetailView.module.css'
import pageScroll from '../styles/page-scroll.module.css'
import { GradientText } from '../components/ui/GradientText'
import detailStyles from './AppPlaylistPage.module.css'
import { fadeRise, springGentle } from '../lib/motion-presets'
import { appPlaylistCoverLayoutId, appPlaylistCovers } from '../lib/app-playlist-presentation'
import { rememberTarget } from '../stores/track-actions'
import { BackButton } from '../components/ui/BackButton'
import { usePageTransition } from '../hooks/useMotion'

type Mode = 'browse' | 'select' | 'reorder'

type IconKind = 'top' | 'up' | 'down' | 'bottom' | 'add' | 'reorder' | 'refresh' | 'rename' | 'delete'
const ICON_PATHS: Record<IconKind, string> = {
  up: 'm6 14 6-6 6 6', down: 'm6 10 6 6 6-6', top: 'M6 5h12M12 19V9m-5 5 5-5 5 5', bottom: 'M6 19h12M12 5v10m-5-5 5 5 5-5',
  add: 'M12 5v14M5 12h14', reorder: 'M7 4v16m-3-3 3 3 3-3M17 20V4m-3 3 3-3 3 3', refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  rename: 'M4 20h4L19 9l-4-4L4 16v4Zm9-13 4 4', delete: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7',
}

function DetailIcon({ kind }: { kind: IconKind }) {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICON_PATHS[kind]} /></svg>
}

export function AppPlaylistPage({ id }: { id: string }) {
  const pageTransition = usePageTransition()
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
    virtual: { listRef, rowHeight: TRACK_ROW_HEIGHT },
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
    if (next === 'reorder') { setQuery(''); setSourceFilter(null); setOnlyUnavailable(false) }
    setMode(next)
    if (next === 'select') requestAnimationFrame(() => selection.rootRef.current?.focus({ preventScroll: true }))
  }
  function clearFilters() { setQuery(''); setSourceFilter(null); setOnlyUnavailable(false) }
  function goToSearch() {
    rememberTarget(id)
    window.dispatchEvent(new Event('simplemusic:focus-search'))
  }
  async function removeSelected() {
    const keys = selectedRows.map(row => appPlaylistTrackKey(row.track))
    if (!keys.length || !window.confirm(`从「${item?.name ?? '应用歌单'}」移出选中的 ${keys.length} 首歌曲？平台歌单和本地文件不受影响。`)) return
    if (!edit(() => useAppPlaylistsStore.getState().removeTracks(id, keys))) return
    selection.clear()
    useToastStore.getState().show(`已移出 ${keys.length} 首歌曲`)
  }
  function removeInvalid() {
    if (!invalidKeys.length || !window.confirm(`移出 ${invalidKeys.length} 首已失效的歌曲？平台歌单和本地文件不受影响。`)) return
    if (!edit(() => useAppPlaylistsStore.getState().removeTracks(id, invalidKeys))) return
    useToastStore.getState().show(`已移出 ${invalidKeys.length} 首已失效歌曲`)
  }

  function edit(action: () => void) {
    try { action(); setError(''); return true }
    catch (failure) { setError(failure instanceof Error ? failure.message : '保存失败，请重试'); return false }
  }
  function playbackTracks(tracks = item?.tracks ?? []) {
    return appPlaylistPlaybackTracks(tracks, { ...context, providers: useProviderStore.getState().byId, offline: currentOffline() })
  }
  function addSelectedToQueue(signal: AbortSignal) {
    if (signal.aborted) return 0
    const tracks = playbackTracks(selectedRows.map(row => row.track))
    if (!tracks.length) throw new Error('当前没有可播放的歌曲')
    return usePlaylistStore.getState().addManyToQueue(tracks, true)
  }
  function play(key?: string) {
    const queue = playbackTracks()
    const index = key ? queue.findIndex(track => appPlaylistTrackKey(track) === key) : 0
    if (!queue.length || index < 0) { useToastStore.getState().show('当前没有可播放的歌曲'); return }
    usePlaylistStore.getState().setQueue(queue, index)
  }

  function playShuffled() {
    const queue = playbackTracks()
    if (!queue.length) { useToastStore.getState().show('当前没有可播放的歌曲'); return }
    useSettingsStore.getState().setPlayMode('shuffle')
    usePlaylistStore.getState().setQueue(queue, Math.floor(Math.random() * queue.length))
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
        <TrackRow track={track} index={position} disabled={!row.available} statusLabel={row.status} statusColumn showInactiveSource hideLikeAction hideOfflineAction onPlay={() => {}} />
      </div>
    }
    if (mode === 'reorder') {
      const last = rows.length - 1
      const move = (target: number) => edit(() => useAppPlaylistsStore.getState().moveTrackTo(id, key, target))
      return <div className={detailStyles.reorderRow} key={key}>
        <TrackRow track={track} index={index} disabled={!row.available} statusLabel={row.status} statusColumn showInactiveSource hideLikeAction hideOfflineAction onPlay={() => play(key)} />
        <div className={detailStyles.reorderActions}>
          <button disabled={index === 0} aria-label={`移到最前：${title}`} title="移到最前" onClick={() => move(0)}><DetailIcon kind="top" /></button>
          <button disabled={index === 0} aria-label={`上移：${title}`} title="上移" onClick={() => move(index - 1)}><DetailIcon kind="up" /></button>
          <button disabled={index === last} aria-label={`下移：${title}`} title="下移" onClick={() => move(index + 1)}><DetailIcon kind="down" /></button>
          <button disabled={index === last} aria-label={`移到最后：${title}`} title="移到最后" onClick={() => move(last)}><DetailIcon kind="bottom" /></button>
        </div>
      </div>
    }
    return <TrackRow key={key} track={track} index={position} disabled={!row.available} statusLabel={row.status} statusColumn showInactiveSource onPlay={() => play(key)} />
  }

  const canPlay = availableCount > 0 && mode === 'browse'

  return <div className={playlistStyles.root}>
    <motion.div layoutScroll className={`${playlistStyles.page} ${pageScroll.viewport}`} ref={scrollRef}>
      <div className={`${playlistStyles.inner} ${detailStyles.page}`} ref={selection.rootRef} {...selection.surfaceProps}>
        <div className={playlistStyles.detailHeader}>
          <BackButton className={playlistStyles.backBtn} onClick={() => useNavigationStore.getState().goBack()} ariaLabel="返回上一页" />
          {item && !archiveError && <div className={playlistStyles.detailMeta}>
            <motion.div className={playlistStyles.detailCover} layoutId={appPlaylistCoverLayoutId(item.id)} layoutCrossfade={false}
              transition={pageTransition(springGentle)} style={{ borderRadius: 16 }}>
              <AppPlaylistCover tracks={item.tracks} />
            </motion.div>
            <motion.div className={playlistStyles.detailInfo} variants={fadeRise} initial="hidden" animate="visible" transition={pageTransition({ ...springGentle, delay: 0.15 })}>
              <div className={playlistStyles.titleRow}>
                <h1 className={playlistStyles.detailTitle}><GradientText>{item.name}</GradientText></h1>
                {mode === 'browse' && <BatchTrackActions compact menuLabel="歌单更多操作" label="整个歌单" tracks={item.tracks}
                  onAddToQueue={async () => {
                    const tracks = playbackTracks()
                    if (!tracks.length) throw new Error('当前没有可播放的歌曲')
                    return usePlaylistStore.getState().addManyToQueue(tracks, true)
                  }}
                  extraItems={[
                    { key: 'add', label: '添加歌曲', icon: <DetailIcon kind="add" />, onSelect: goToSearch },
                    ...(item.tracks.length > 1 ? [{ key: 'reorder', label: '调整顺序', icon: <DetailIcon kind="reorder" />, onSelect: () => enterMode('reorder') }] : []),
                    { key: 'refresh', label: '刷新可用状态', icon: <DetailIcon kind="refresh" />, onSelect: () => setRefresh(value => value + 1) },
                    { key: 'rename', label: '重命名歌单', icon: <DetailIcon kind="rename" />, onSelect: () => setEditing('rename') },
                    { key: 'delete', label: '删除歌单', icon: <DetailIcon kind="delete" />, danger: true, onSelect: () => setEditing('delete') },
                  ]} onSelect={() => enterMode('select')} />}
              </div>
              {/* 来源徽标兼作筛选；不可播放的歌曲可单独查看。 */}
              <div className={playlistStyles.badgeRow}>
                <AppPlaylistSources tracks={item.tracks} selected={mode === 'reorder' ? null : sourceFilter} onSelect={mode === 'reorder' ? undefined : setSourceFilter} />
                {unavailableCount > 0 && mode !== 'reorder' && <button type="button" className={`${detailStyles.unavailableChip} no-drag`} aria-pressed={onlyUnavailable}
                  title={onlyUnavailable ? '显示全部歌曲' : '只看暂不可播放的歌曲'} onClick={() => setOnlyUnavailable(value => !value)}>
                  <span className={detailStyles.unavailableDot} aria-hidden="true" />{unavailableCount} 首不可播放
                </button>}
              </div>
              <p className={playlistStyles.detailSub}>应用歌单 · {item.tracks.length} 首歌曲 · 当前可播放 {availableCount} 首</p>
              <div className={playlistStyles.headerActions}>
                <button type="button" className={`${playlistStyles.playAllBtn} no-drag`} disabled={!canPlay} onClick={() => play()}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l13-7.5z" /></svg>播放全部
                </button>
                <button type="button" className={`${playlistStyles.shuffleBtn} no-drag`} disabled={!canPlay} onClick={playShuffled}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" /></svg>随机播放
                </button>
              </div>
            </motion.div>
          </div>}
        </div>
        {!item || archiveError ? <div className={styles.empty} role={archiveError ? 'alert' : undefined}><p>{archiveError || '这个应用歌单已被删除'}</p></div> : <>
          {mode !== 'reorder' && onlyUnavailable && <div className={detailStyles.notice} role="status">
            <p>{invalidKeys.length
              ? `其中 ${invalidKeys.length} 首已失效（本地文件不存在或曲目下架）${unavailableCount > invalidKeys.length ? '，其余重新登录或启用平台后即可恢复' : ''}。`
              : '这些歌曲在重新登录或启用对应平台后即可恢复，无需移出。'}</p>
            {invalidKeys.length > 0 && <button type="button" className={`${detailStyles.noticeAction} no-drag`} onClick={removeInvalid}>移出 {invalidKeys.length} 首已失效歌曲</button>}
          </div>}
          {mode === 'select' && <BatchTrackActions tracks={selectedRows.map(row => row.track)} onDone={selection.clear} onRemove={removeSelected} onAddToQueue={addSelectedToQueue} removeLabel="移出应用歌单"
            selection={{ total: visible.length, onSelectAll: selection.selectAll, onClear: selection.clear, onExit: selection.exit }} />}
          {error && <p className={playlistStyles.managementFeedback} role="alert">{error}</p>}
          {offlineError && <p className={playlistStyles.managementFeedback} role="alert">{offlineError}</p>}
          {mode === 'reorder' ? <div className={detailStyles.reorderBar} role="region" aria-label="调整顺序">
            <div><strong>调整顺序</strong><span>改动立即保存，下次播放按新顺序。</span></div>
            <button type="button" className="no-drag" onClick={() => setMode('browse')}>完成</button>
          </div> : item.tracks.length > 0 && <TrackSearch value={query} onChange={setQuery} placeholder="搜索歌单内的歌曲或歌手" count={visible.length} />}
          {!item.tracks.length ? <div className={playlistStyles.emptyPlaylist}><p>歌单还是空的</p><span>搜索歌曲后点「＋」选择这份歌单，也可从播放栏或其他歌曲列表加入。</span>
            <button type="button" className={`${playlistStyles.retryBtn} no-drag`} onClick={goToSearch}>去搜索歌曲</button></div>
            : !visible.length ? <div className={playlistStyles.emptyPlaylist}><p>没有符合条件的歌曲</p>
              <button type="button" className={`${playlistStyles.retryBtn} no-drag`} onClick={clearFilters}>清除筛选</button></div>
            : <motion.div className={playlistStyles.trackList} ref={listRef} variants={fadeRise} initial="hidden" animate="visible" transition={pageTransition({ ...springGentle, delay: 0.15 })}>
              <VirtualList total={visible.length} rowHeight={TRACK_ROW_HEIGHT} scrollRef={scrollRef} renderRow={renderRow} />
            </motion.div>}
          {editing === 'rename' && <AppPlaylistNameDialog title="重命名应用歌单" initialName={item.name} onClose={() => setEditing(null)} onSubmit={name => useAppPlaylistsStore.getState().rename(id, name)} />}
          {editing === 'delete' && <AppPlaylistModal title="删除应用歌单" onClose={() => setEditing(null)}>
            <p className={styles.hint}>确定删除「{item.name}」？当前播放队列和歌曲文件会保留。</p>
            <div className={styles.buttons}><button autoFocus onClick={() => setEditing(null)}>取消</button><button className={styles.danger} onClick={() => edit(() => {
              useAppPlaylistsStore.getState().remove(id)
              setEditing(null)
              useNavigationStore.getState().goBack()
            })}>删除歌单</button></div>
            {error && <p className={styles.error} role="alert">{error}</p>}
          </AppPlaylistModal>}
        </>}
      </div>
      <SelectionMarquee rect={selection.marquee} />
    </motion.div>
  </div>
}
