// 歌单详情共用视图(Library / Explore 共用):
// 全骨架懒加载(useLazyPlaylist)+ 虚拟列表(VirtualList),未加载行显示 shimmer 占位。
// 播放任意一行时按完整 trackIds 入队,未加载详情的为 pending 占位曲目。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { useLazyPlaylist } from '../../hooks/useLazyPlaylist'
import { useNavigationStore } from '../../stores/navigation'
import { usePlaylistStore } from '../../stores/playlist'
import { useSettingsStore } from '../../stores/settings'
import { useBackdropStore } from '../../stores/backdrop'
import { serviceFor } from '../../lib/service-registry'
import { TrackSearch } from '../ui/TrackSearch'
import { matchingTrackIndices } from '../../lib/track-search'
import { GradientText } from '../ui/GradientText'
import { VirtualList } from '../ui/VirtualList'
import { TrackRow } from '../Explore/TrackRow'
import { SourceBadge } from '../ui/SourceBadge'
import { LockGlyph } from '../ui/LockGlyph'
import { PlaylistCoverFallback } from '../ui/PlaylistCoverFallback'
import { QQLikedCoverOverlay } from '../ui/QQLikedCoverOverlay'
import { fadeRise, springGentle, albumCoverTransition } from '../../lib/motion-presets'
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
import { BackButton } from '../ui/BackButton'
import { useCollectionSubscription } from '../../hooks/useCollectionSubscription'
import { usePageTransition } from '../../hooks/useMotion'

/** TrackRow 实测高度:上下 padding 8×2 + 封面 40。虚拟列表按此定位,改 TrackRow 尺寸需同步。 */
export const TRACK_ROW_HEIGHT = 56

interface PlaylistDetailViewProps {
  playlist: Playlist
  initialTracks?: Track[]
  layoutIdPrefix: string
}

const REFRESH_ICON = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" /></svg>
const RENAME_ICON = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4Zm9-13 4 4" /></svg>

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

function formatPlayCount(count: number): string {
  if (count >= 1e8) return `${(count / 1e8).toFixed(1).replace(/\.0$/, '')}亿`
  if (count >= 1e4) return `${(count / 1e4).toFixed(1).replace(/\.0$/, '')}万`
  return String(count)
}

export function PlaylistDetailView({ playlist, initialTracks, layoutIdPrefix }: PlaylistDetailViewProps) {
  const pageTransition = usePageTransition()
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
  const [managedPlaylist, setManagedPlaylist] = useState<{ scope: string; name: string; private?: boolean } | null>(null)
  const [privacyBusy, setPrivacyBusy] = useState(false)
  const managementRevision = usePlatformPlaylistsStore(state => playlist.source === 'netease' || playlist.source === 'qq' ? state.revision[playlist.source] : 0)
  const [query, setQuery] = useState('')
  const [selecting, setSelecting] = useState(false)
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState(false)
  const [searchAttempt, setSearchAttempt] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
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
  const collection = useCollectionSubscription(playlist)
  const collectable = !initialTracks?.length && (collection.state === 'subscribed' || collection.state === 'none')
  const { total, tracks, meta, loading, provisional, whenReady, error, available, ensureRange, ensureAll, makeQueue, refresh, checkForUpdates, canCheckForUpdates, retry } = useLazyPlaylist(playlist, initialTracks)
  const canRefresh = playlist.type !== 'album' && !initialTracks?.length
  const refreshPlaylist = useCallback(async () => {
    if (!canRefresh || !currentRequest() || refreshInFlight.current) return
    refreshInFlight.current = true
    setRefreshing(true)
    try {
      await refresh()
    } catch {
      if (currentRequest()) useToastStore.getState().show('歌单刷新失败，请稍后重试')
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
  // 可见性只对本人歌单展示；切换目前只有网易云支持。
  // 可管理时以核验结果为准；核验未完成或失败时退回账号歌单清单里的可见性（只读展示，收藏的不显示）
  const isPrivate = canManage ? managedPlaylist.private : playlist.subscribed ? undefined : playlist.private
  const canTogglePrivacy = canManage && isPrivate !== undefined && playlist.source === 'netease'
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

  useEffect(() => { setRenaming(false); setManagementFeedback(''); setPrivacyBusy(false) }, [requestScope])
  useEffect(() => {
    setManagedPlaylist(previous => previous?.scope === requestScope ? previous : null)
    if (isAlbum || initialTracks?.length || !supportsPlatformPlaylists(playlist.source) || !/^[1-9]\d*$/.test(String(playlist.id))) return
    const controller = new AbortController()
    void inspectPlatformPlaylist(playlist.source, String(playlist.id), controller.signal).then(result => {
      if (!controller.signal.aborted && currentRequest()) setManagedPlaylist({ scope: requestScope, name: result.name, private: result.private })
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

  async function togglePrivacy() {
    if (!canTogglePrivacy || privacyBusy || !supportsPlatformPlaylists(playlist.source)) return
    const scope = requestScope
    setPrivacyBusy(true)
    setManagementFeedback('')
    try {
      const result = await mutatePlatformPlaylist(playlist.source, { action: 'privacy', playlistId: String(playlist.id), public: isPrivate })
      if (!currentRequest()) return
      if (result.status !== 'complete') { setManagementFeedback(platformPlaylistResultMessage(result, 'privacy')); return }
      setManagedPlaylist(previous => previous?.scope === scope ? { ...previous, private: !isPrivate } : previous)
      useToastStore.getState().show(isPrivate ? '已设为公开歌单' : '已设为私有歌单')
    } catch (failure) {
      if (currentRequest()) setManagementFeedback(`可见性未能确认，请刷新歌单查看。${failure instanceof Error ? failure.message : '平台操作失败'}`)
    } finally {
      if (currentRequest()) setPrivacyBusy(false)
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
    if (provisional) {
      // 首屏曲目只是整单的前缀:等整单到了再按曲目 id 定位,避免只播这一页
      const picked = tracks[index]
      void whenReady().then(() => {
        if (!currentRequest()) return
        const queue = makeQueue()
        if (!queue.length) return
        const found = picked ? queue.findIndex((track) => String(track.id) === String(picked.id)) : index
        usePlaylistStore.getState().setQueue(queue, Math.max(0, found), playlist.id)
      })
      return
    }
    const queue = makeQueue()
    if (!queue.length) return
    usePlaylistStore.getState().setQueue(queue, index, playlist.id)
  }

  function playShuffled() {
    const queue = makeQueue()
    if (!queue.length) return
    useSettingsStore.getState().setPlayMode('shuffle')
    usePlaylistStore.getState().setQueue(queue, Math.floor(Math.random() * queue.length), playlist.id)
  }

  // 入口数据(账号歌单列表等)常缺简介/创建者/播放量,用歌单接口顺带返回的资料补全
  const description = displayPlaylist.description || meta?.description || ''
  const infoLine = [
    displayPlaylist.creator || meta?.creator,
    isAlbum ? displayPlaylist.tag : undefined,
    (displayPlaylist.playCount || meta?.playCount) ? `${formatPlayCount(displayPlaylist.playCount || meta?.playCount || 0)} 次播放` : undefined,
  ].filter(Boolean).join(' · ')
  const canPlay = !loading && !error && total > 0 && !selecting

  if (!available) return null

  return (
    <div className={styles.root}>
      <motion.div layoutScroll className={`${styles.page} ${pageScroll.viewport}`} ref={pageRef}>
        <div className={styles.inner} ref={selection.rootRef} {...selection.surfaceProps}>
          <div className={styles.detailHeader}>
            <BackButton className={styles.backBtn} onClick={() => useNavigationStore.getState().goBack()} ariaLabel="返回上一页" />
            <div className={styles.detailMeta}>
              <motion.div
                className={styles.detailCover}
                layoutId={coverLayoutId}
                layoutCrossfade={false}
                transition={pageTransition(isAlbum ? albumCoverTransition : springGentle)}
                style={{ borderRadius: 16 }}
              >
                {displayCover
                  ? <img src={sizedImage(displayCover, 512)} alt="" />
                  : <PlaylistCoverFallback name={displayPlaylist.name} source={displayPlaylist.source} />}
                {displayCover && <QQLikedCoverOverlay playlist={displayPlaylist} />}
              </motion.div>
              <motion.div className={styles.detailInfo} variants={fadeRise} initial="hidden" animate="visible" transition={pageTransition({ ...springGentle, delay: 0.15 })}>
                <div className={styles.titleRow}>
                  <h1 className={styles.detailTitle}><GradientText>{displayPlaylist.name}</GradientText></h1>
                  {collectable && <button type="button" className={`${styles.collectBtn} no-drag`} aria-pressed={collection.state === 'subscribed'}
                    disabled={collection.busy} onClick={() => void collection.toggle()}
                    title={collection.state === 'subscribed' ? '取消收藏' : `收藏${isAlbum ? '专辑' : '歌单'}`}
                    aria-label={collection.state === 'subscribed' ? '取消收藏' : `收藏${isAlbum ? '专辑' : '歌单'}`}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill={collection.state === 'subscribed' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" aria-hidden="true"><path d="M7 4h10v16l-5-3.6L7 20z" /></svg>
                  </button>}
                  {!selecting && <BatchTrackActions compact menuLabel={isAlbum ? '专辑更多操作' : '歌单更多操作'} label={isAlbum ? '整张专辑' : '整个歌单'}
                    tracks={loading || error || !initialTracks?.length ? [] : makeQueue()}
                    collections={loading || error || initialTracks?.length ? [] : [{ ...displayPlaylist, trackCount: total, trackCountKnown: true }]}
                    extraItems={[
                      ...(canRefresh ? [{ key: 'refresh', label: refreshing ? '刷新中…' : '刷新歌单', icon: REFRESH_ICON, disabled: refreshing, onSelect: () => void refreshPlaylist() }] : []),
                      ...(canManage && supportsPlatformPlaylists(playlist.source) ? [{ key: 'rename', label: '重命名歌单', icon: RENAME_ICON, onSelect: () => setRenaming(true) }] : []),
                      ...(canTogglePrivacy ? [{ key: 'privacy', label: isPrivate ? '设为公开歌单' : '设为私有歌单', icon: <LockGlyph open={!isPrivate} size={16} />, disabled: privacyBusy, onSelect: () => void togglePrivacy() }] : []),
                    ]} onSelect={() => { setSelecting(true); selection.rootRef.current?.focus({ preventScroll: true }) }} />}
                </div>
                <div className={styles.badgeRow}>
                  <SourceBadge source={displayPlaylist.source} reveal />
                  {/* 本人歌单显示可见性；网易云可直接点锁切换。 */}
                  {isPrivate !== undefined && (canTogglePrivacy
                    ? <button type="button" className={`${styles.privacyChip} no-drag`} data-public={!isPrivate} aria-busy={privacyBusy} disabled={privacyBusy}
                      title={isPrivate ? '点击设为公开，其他人可在你的主页看到' : '点击设为私有，仅自己可见'}
                      aria-label={isPrivate ? '私有歌单，点击设为公开' : '公开歌单，点击设为私有'} onClick={() => void togglePrivacy()}>
                      <LockGlyph open={!isPrivate} size={13} />{isPrivate ? '私有歌单' : '公开歌单'}
                    </button>
                    : <span className={styles.privacyChip} data-public={!isPrivate}><LockGlyph open={!isPrivate} size={13} />{isPrivate ? '私有歌单' : '公开歌单'}</span>)}
                </div>
                {/* 曲数由下方列表标题展示，这里只放作者、标签与播放量。 */}
                {infoLine && <p className={styles.detailSub}>{infoLine}</p>}
                {description && <p className={styles.detailDescription} title={description}>{description}</p>}
                <div className={styles.headerActions}>
                  <button type="button" className={`${styles.playAllBtn} no-drag`} disabled={!canPlay} onClick={() => playAt(0)}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l13-7.5z" /></svg>播放全部
                  </button>
                  <button type="button" className={`${styles.shuffleBtn} no-drag`} disabled={!canPlay} onClick={playShuffled}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" /></svg>随机播放
                  </button>
                </div>
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
            count={searching ? matches.length : provisional ? 0 : total}
            loading={searchLoading || loading}
            error={searchError}
            onRetry={() => setSearchAttempt((value) => value + 1)}
          />
          {!loading && !error && total === 0 && canManage && <div className={styles.emptyPlaylist}><p>歌单还是空的</p><span>从歌曲的更多操作中选择「加入歌单」。</span></div>}
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
              transition={pageTransition({ ...springGentle, delay: 0.15 })}
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
                      {t ? <TrackRow track={t} hideCover={isAlbum} hideSource={t.source === displayPlaylist.source} hideOfflineAction hideLikeAction index={i} disabled={isCatalogUnavailable(item)} onPlay={() => {}} /> : <SkeletonTrackRow index={i} hideCover={isAlbum} />}
                    </div>
                  }
                  return t ? <TrackRow track={t} hideCover={isAlbum} hideSource={t.source === displayPlaylist.source} index={i} onPlay={() => playAt(originalIndex)} /> : <SkeletonTrackRow index={i} hideCover={isAlbum} />
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
