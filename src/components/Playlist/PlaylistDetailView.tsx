// 歌单详情共用视图(Library / Explore 共用):
// 全骨架懒加载(useLazyPlaylist)+ 虚拟列表(VirtualList),未加载行显示 shimmer 占位。
// 播放任意一行时按完整 trackIds 入队,未加载详情的为 pending 占位曲目。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { useLazyPlaylist } from '../../hooks/useLazyPlaylist'
import { useNavigationStore } from '../../stores/navigation'
import { usePlaylistStore } from '../../stores/playlist'
import { useBackdropStore } from '../../stores/backdrop'
import { serviceFor } from '../../lib/service-registry'
import { TrackSearch } from '../ui/TrackSearch'
import { matchingTrackIndices } from '../../lib/track-search'
import { GradientText } from '../ui/GradientText'
import { VirtualList } from '../ui/VirtualList'
import { TrackRow } from '../Explore/TrackRow'
import { SourceBadge } from '../ui/SourceBadge'
import { PlaylistCoverFallback } from '../ui/PlaylistCoverFallback'
import { QQLikedCoverOverlay } from '../ui/QQLikedCoverOverlay'
import { fadeRise, springGentle, springSnappy, tapScale, albumCoverTransition } from '../../lib/motion-presets'
import { sizedImage } from '../../lib/image-size'
import { useProviderStore } from '../../stores/providers'
import { isProviderId } from '../../providers/types'
import { providerAccountSession } from '../../lib/provider-account-session'
import { useMultiSelection } from '../../hooks/useMultiSelection'
import { SelectionCheck, SelectionMarquee } from './SelectionControls'
import { inspectPlatformPlaylist, mutatePlatformPlaylist, platformPlaylistResultMessage, supportsPlatformPlaylists } from '../../lib/platform-playlists'
import { usePlatformPlaylistsStore } from '../../stores/platform-playlists'
import { useToastStore } from '../../stores/toast'
import { PlatformPlaylistNameDialog } from './PlatformPlaylistDialog'
import { BatchTrackActions } from './BatchTrackActions'
import { mergeAlbumDetail } from './album-detail'
import type { Playlist, Track } from '../../types/domain'
import { isCatalogUnavailable } from '../../lib/track-availability'
import styles from './PlaylistDetailView.module.css'
import pageScroll from '../../styles/page-scroll.module.css'

/** TrackRow 实测高度:上下 padding 8×2 + 封面 40。虚拟列表按此定位,改 TrackRow 尺寸需同步。 */
export const TRACK_ROW_HEIGHT = 56

interface PlaylistDetailViewProps {
  playlist: Playlist
  initialTracks?: Track[]
  layoutIdPrefix: string
}

function SkeletonTrackRow({ index, hideCover }: { index: number; hideCover?: boolean }) {
  return (
    <div className={styles.skeletonRow} aria-hidden="true">
      <span className={styles.skeletonIndex}>{index + 1}</span>
      {!hideCover && <span className={styles.skeletonCover} />}
      <span className={styles.skeletonLines}>
        <i />
        <i />
      </span>
    </div>
  )
}

export function PlaylistDetailView({ playlist, initialTracks, layoutIdPrefix }: PlaylistDetailViewProps) {
  const active = useNavigationStore((state) => {
    const view = state.currentView
    return typeof view === 'object' && view.type === 'playlist'
      && view.playlist.source === playlist.source && String(view.playlist.id) === String(playlist.id)
  })
  const accountSignature = useProviderStore(state => isProviderId(playlist.source)
    ? `${state.byId[playlist.source].enabled}:${state.byId[playlist.source].auth}:${providerAccountSession(playlist.source)}` : 'local')
  const accountSession = isProviderId(playlist.source) ? providerAccountSession(playlist.source) : 0
  const requestScope = `${playlist.source}:${playlist.type}:${String(playlist.id)}:${accountSignature}`
  const [renaming, setRenaming] = useState(false)
  const [managementFeedback, setManagementFeedback] = useState('')
  const [managedPlaylist, setManagedPlaylist] = useState<{ scope: string; name: string } | null>(null)
  const managementRevision = usePlatformPlaylistsStore(state => playlist.source === 'netease' || playlist.source === 'qq' ? state.revision[playlist.source] : 0)
  const [query, setQuery] = useState('')
  const [selecting, setSelecting] = useState(false)
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState(false)
  const [searchAttempt, setSearchAttempt] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState(false)
  const refreshInFlight = useRef(false)
  const checkInFlight = useRef(false)
  const scopeRef = useRef<string | null>(requestScope)
  if (scopeRef.current !== requestScope) {
    scopeRef.current = requestScope
    refreshInFlight.current = false
    checkInFlight.current = false
  }
  const currentRequest = () => scopeRef.current === requestScope
    && (!isProviderId(playlist.source) || accountSession === providerAccountSession(playlist.source))
  useEffect(() => {
    scopeRef.current = requestScope
    setRefreshing(false)
    setRefreshError(false)
    return () => { scopeRef.current = null }
  }, [requestScope])
  const searching = Boolean(query.trim())
  const isAlbum = playlist.type === 'album'
  const coverLayoutId = isAlbum ? `album-cover-${playlist.source}-${String(playlist.id)}` : `${layoutIdPrefix}-${String(playlist.id)}`
  const pageRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [albumSnapshot, setAlbumDetail] = useState<{ scope: string; playlist: Playlist } | null>(null)
  const albumDetail = albumSnapshot?.scope === requestScope ? albumSnapshot.playlist : null
  const service = serviceFor(playlist.source)
  const { total, tracks, loading, error, available, ensureRange, ensureAll, makeQueue, refresh, checkForUpdates, canCheckForUpdates, retry } = useLazyPlaylist(playlist, initialTracks)
  const canRefresh = playlist.type !== 'album' && !initialTracks?.length
  const refreshPlaylist = useCallback(async () => {
    if (!canRefresh || !currentRequest() || refreshInFlight.current) return
    refreshInFlight.current = true
    setRefreshing(true)
    setRefreshError(false)
    try {
      await refresh()
    } catch {
      if (currentRequest()) setRefreshError(true)
    } finally {
      if (currentRequest()) {
        refreshInFlight.current = false
        setRefreshing(false)
      }
    }
  }, [canRefresh, refresh, requestScope])
  const checkPlaylist = useCallback(async () => {
    if (!canRefresh || !currentRequest() || checkInFlight.current || refreshInFlight.current) return
    checkInFlight.current = true
    try {
      await checkForUpdates()
    } catch {
      // 自动检查失败时保留现有歌曲；下次回到前台或定时检查会重试。
    } finally {
      if (currentRequest()) checkInFlight.current = false
    }
  }, [canRefresh, checkForUpdates, requestScope])
  useEffect(() => {
    if (!canRefresh) return
    const onFocus = () => { void checkPlaylist() }
    window.addEventListener('focus', onFocus)
    const interval = canCheckForUpdates
      ? window.setInterval(() => { if (document.visibilityState === 'visible') void checkPlaylist() }, 60_000)
      : null
    return () => {
      window.removeEventListener('focus', onFocus)
      if (interval !== null) window.clearInterval(interval)
    }
  }, [canRefresh, canCheckForUpdates, checkPlaylist])
  const matches = searching ? matchingTrackIndices(tracks, query, true) : []
  useEffect(() => { setQuery('') }, [playlist.id, playlist.source])
  useEffect(() => {
    let cancelled = false
    setSearchError(false)
    setSearchLoading(searching && !error)
    if (!searching || loading || error) return
    void ensureAll(() => cancelled)
      .catch(() => { if (!cancelled) setSearchError(true) })
      .finally(() => { if (!cancelled) setSearchLoading(false) })
    return () => { cancelled = true }
  }, [searching, loading, error, ensureAll, searchAttempt])
  const basePlaylist = mergeAlbumDetail(playlist, albumDetail)
  const canManage = managedPlaylist?.scope === requestScope
  const displayPlaylist = canManage ? { ...basePlaylist, name: managedPlaylist.name } : basePlaylist
  const selectionQueue = useMemo(() => selecting ? makeQueue() : [], [selecting, tracks, total])
  const visibleSelectionTracks = searching ? matches.map(index => selectionQueue[index]).filter(Boolean) : selectionQueue
  const selection = useMultiSelection({
    enabled: selecting,
    keys: visibleSelectionTracks.map(track => String(track.id)),
    resetKey: `${playlist.source}:${String(playlist.id)}:${query}:${accountSignature}`,
    onExit: () => setSelecting(false),
    virtual: { listRef, rowHeight: TRACK_ROW_HEIGHT },
  })
  const { selected } = selection
  const selectedTracks = selectionQueue.filter((track) => selected.has(String(track.id)))
  useEffect(() => { setSelecting(false) }, [playlist.id, playlist.source])
  const displayCover = displayPlaylist.cover || tracks.find((track) => track?.cover)?.cover || ''

  useEffect(() => {
    let cancelled = false
    setAlbumDetail(null)
    if (!available || playlist.type !== 'album' || !service.getAlbumDetail) return () => { cancelled = true }
    void service.getAlbumDetail(playlist.id)
      .then((detail) => { if (!cancelled && currentRequest() && detail) setAlbumDetail({ scope: requestScope, playlist: detail }) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [available, playlist.id, playlist.source, playlist.type, service, requestScope])

  useEffect(() => { setRenaming(false); setManagementFeedback('') }, [requestScope])
  useEffect(() => {
    setManagedPlaylist(previous => previous?.scope === requestScope ? previous : null)
    if (isAlbum || initialTracks?.length || !supportsPlatformPlaylists(playlist.source) || !/^[1-9]\d*$/.test(String(playlist.id))) return
    const controller = new AbortController()
    void inspectPlatformPlaylist(playlist.source, String(playlist.id), controller.signal).then(result => {
      if (!controller.signal.aborted && currentRequest()) setManagedPlaylist({ scope: requestScope, name: result.name })
    }).catch(() => { /* 收藏、系统和非本人歌单继续只读；服务端是编辑权限依据。 */ })
    return () => controller.abort()
  }, [requestScope, managementRevision])

  const previousManagementRevision = useRef(managementRevision)
  useEffect(() => {
    if (previousManagementRevision.current === managementRevision || refreshInFlight.current) return
    previousManagementRevision.current = managementRevision
    if (canRefresh) void refreshPlaylist()
  }, [managementRevision, refreshPlaylist, canRefresh, refreshing])

  async function removeSelected(signal: AbortSignal) {
    if (!canManage || !supportsPlatformPlaylists(playlist.source) || !selectedTracks.length) return
    if (!window.confirm(`从${playlist.source === 'qq' ? 'QQ 音乐' : '网易云'}歌单「${displayPlaylist.name}」移除选中的 ${selectedTracks.length} 首歌曲？应用歌单和本地文件会保留。`)) return
    setManagementFeedback('')
    try {
      const result = await mutatePlatformPlaylist(playlist.source, { action: 'remove', playlistId: String(playlist.id), tracks: selectedTracks.map(track => ({ source: track.source, id: String(track.id), qqId: track.qqId === undefined ? undefined : String(track.qqId), songType: typeof track.songType === 'number' ? track.songType : undefined })) }, signal)
      if (!currentRequest() || signal.aborted) return
      const message = platformPlaylistResultMessage(result, 'remove')
      if (result.status !== 'complete') { setManagementFeedback(message); return }
      useToastStore.getState().show(message)
      selection.clear()
    } catch (failure) {
      if (currentRequest() && !signal.aborted) setManagementFeedback(`操作结果尚未确认，请刷新歌单查看。${failure instanceof Error ? failure.message : '平台操作失败'}`)
    }
  }

  // 平台一旦停止参与，立即退出其详情页；避免保留来源标识、重试按钮等失效交互。
  useEffect(() => {
    if (!available) useNavigationStore.getState().goBack()
  }, [available])

  // 歌单封面模糊后作为全局背景(铺满整个应用);离开详情页时清空
  useEffect(() => {
    if (active) return useBackdropStore.getState().setCover(displayCover)
  }, [active, displayCover])

  function playAt(index: number) {
    const queue = makeQueue()
    if (!queue.length) return
    usePlaylistStore.getState().setQueue(queue, index, playlist.id)
  }

  if (!available) return null

  return (
    <div className={styles.root}>
      <motion.div layoutScroll className={`${styles.page} ${pageScroll.viewport}`} ref={pageRef}>
        <div className={styles.inner} ref={selection.rootRef} {...selection.surfaceProps}>
          <div className={styles.detailHeader}>
            <motion.button
              className={`${styles.backBtn} no-drag`}
              onClick={() => useNavigationStore.getState().goBack()}
              aria-label="返回上一页"
              whileTap={tapScale}
              transition={springSnappy}
            >
              <svg
                className={styles.backIcon}
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M15 18l-6-6 6-6" />
              </svg>
              <span>返回</span>
            </motion.button>
            <div className={styles.detailMeta}>
              <motion.div
                className={`${styles.detailCover}${isAlbum ? ` ${styles.albumCover}` : ''}`}
                layoutId={coverLayoutId}
                layoutCrossfade={false}
                transition={isAlbum ? albumCoverTransition : springGentle}
                style={{ borderRadius: isAlbum ? 16 : 12 }}
              >
                {displayCover
                  ? <img src={sizedImage(displayCover, isAlbum ? 512 : 176)} alt="" />
                  : <PlaylistCoverFallback name={displayPlaylist.name} source={displayPlaylist.source} />}
                {displayCover && <QQLikedCoverOverlay playlist={displayPlaylist} />}
              </motion.div>
              <motion.div className={styles.detailInfo} variants={fadeRise} initial="hidden" animate="visible" transition={{ ...springGentle, delay: 0.15 }}>
                <div className={styles.titleRow}>
                  <h1 className={styles.detailTitle}><GradientText>{displayPlaylist.name}</GradientText></h1>
                  {!selecting && <BatchTrackActions compact menuLabel={isAlbum ? '专辑更多操作' : '歌单更多操作'} label={isAlbum ? '整张专辑' : '整个歌单'}
                    tracks={loading || error || !initialTracks?.length ? [] : makeQueue()}
                    collections={loading || error || initialTracks?.length ? [] : [{ ...displayPlaylist, trackCount: total, trackCountKnown: true }]} onSelect={() => { setSelecting(true); selection.rootRef.current?.focus({ preventScroll: true }) }} />}
                </div>
                <SourceBadge source={displayPlaylist.source} reveal />
                <p className={styles.detailSub}>
                  {displayPlaylist.type === 'album'
                    ? [displayPlaylist.creator, displayPlaylist.tag, loading ? '加载中…' : `${total} 首`]
                        .filter(Boolean)
                        .join(' · ')
                    : loading ? '加载中…' : `${total} 首`}
                </p>
                {canRefresh && (
                  <button type="button" className={`${styles.refreshBtn} no-drag`} onClick={() => void refreshPlaylist()} disabled={refreshing}>
                    {refreshing ? '刷新中…' : refreshError ? '刷新失败，重试' : '刷新歌单'}
                  </button>
                )}
                {canManage && supportsPlatformPlaylists(playlist.source) && <button type="button" className={`${styles.refreshBtn} ${styles.renameBtn} no-drag`} onClick={() => setRenaming(true)}>重命名歌单</button>}
                {displayPlaylist.type === 'album' && displayPlaylist.description && (
                  <p className={styles.detailDescription}>{displayPlaylist.description}</p>
                )}
              </motion.div>
            </div>
          </div>
          {renaming && supportsPlatformPlaylists(playlist.source) && <PlatformPlaylistNameDialog source={playlist.source} playlist={displayPlaylist} onClose={() => setRenaming(false)} />}
          {selecting && <BatchTrackActions tracks={selectedTracks} onDone={selection.clear} onRemove={canManage ? removeSelected : undefined}
            selection={{ total: visibleSelectionTracks.length, onSelectAll: selection.selectAll, onClear: selection.clear, onExit: selection.exit }} />}
          {managementFeedback && <p className={styles.managementFeedback} role="status">{managementFeedback}</p>}
          <TrackSearch
            value={query}
            onChange={setQuery}
            placeholder={isAlbum ? "搜索专辑内的歌曲或歌手" : "搜索歌单内的歌曲或歌手"}
            count={searching ? matches.length : total}
            loading={searchLoading || loading}
            error={searchError}
            onRetry={() => setSearchAttempt((value) => value + 1)}
          />
          {!loading && !error && total === 0 && canManage && <div className={styles.emptyPlaylist}><p>歌单还是空的</p><span>从歌曲的更多操作中选择「加入平台歌单」。</span></div>}
          {error ? (
            <div className={styles.errorHint}>
              <p>歌单加载失败</p>
              <button className={`${styles.retryBtn} no-drag`} onClick={retry}>
                重试
              </button>
            </div>
          ) : (
            <motion.div
              className={styles.trackList}
              ref={listRef}
              variants={fadeRise}
              initial="hidden"
              animate="visible"
              transition={{ ...springGentle, delay: 0.15 }}
            >
              <VirtualList
                total={searching ? matches.length : total}
                rowHeight={TRACK_ROW_HEIGHT}
                scrollRef={pageRef}
                onRangeChange={searching ? undefined : ensureRange}
                renderRow={(i) => {
                  const originalIndex = searching ? matches[i] : i
                  const t = tracks[originalIndex]
                  if (selecting) {
                    const item = selectionQueue[originalIndex]
                    if (!item) return <SkeletonTrackRow index={i} hideCover={isAlbum} />
                    return <div className={styles.selectableRow} data-selected={selected.has(String(item.id))} data-selection-key={String(item.id)} data-unavailable={isCatalogUnavailable(item)}>
                      <SelectionCheck label={`选择歌曲：${item.pending ? `第 ${i + 1} 首` : item.name}`} checked={selected.has(String(item.id))} />
                      {t ? <TrackRow track={t} hideCover={isAlbum} hideOfflineAction hideLikeAction index={i} disabled={isCatalogUnavailable(item)} onPlay={() => {}} /> : <SkeletonTrackRow index={i} hideCover={isAlbum} />}
                    </div>
                  }
                  return t ? <TrackRow track={t} hideCover={isAlbum} index={i} onPlay={() => playAt(originalIndex)} /> : <SkeletonTrackRow index={i} hideCover={isAlbum} />
                }}
              />
            </motion.div>
          )}
        </div>
        <SelectionMarquee rect={selection.marquee} />
      </motion.div>
    </div>
  )
}
