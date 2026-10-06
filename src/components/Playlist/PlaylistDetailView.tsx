// 歌单详情共用视图(Library / Explore 共用):
// 全骨架懒加载(useLazyPlaylist)+ 虚拟列表(VirtualList),未加载行显示 shimmer 占位。
// 播放任意一行时按完整 trackIds 入队,未加载详情的为 pending 占位曲目。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { useScrollGradient } from '../../hooks/useScrollGradient'
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
import { fadeRise, springGentle, springSnappy, tapScale, albumCoverTransition } from '../../lib/motion-presets'
import { sizedImage } from '../../lib/image-size'
import { BatchTrackActions } from './BatchTrackActions'
import { mergeAlbumDetail } from './album-detail'
import type { Playlist, Track } from '../../types/domain'
import styles from './PlaylistDetailView.module.css'

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
  const [query, setQuery] = useState('')
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState(false)
  const [searchAttempt, setSearchAttempt] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState(false)
  const refreshInFlight = useRef(false)
  const checkInFlight = useRef(false)
  const searching = Boolean(query.trim())
  const isAlbum = playlist.type === 'album'
  const coverLayoutId = isAlbum ? `album-cover-${playlist.source}-${String(playlist.id)}` : `${layoutIdPrefix}-${String(playlist.id)}`
  const pageRef = useRef<HTMLDivElement>(null)
  const [albumDetail, setAlbumDetail] = useState<Playlist | null>(null)
  const service = serviceFor(playlist.source)
  const { topOpacity, bottomOpacity, handleScroll, setTopOpacity, setBottomOpacity } = useScrollGradient()
  const { total, tracks, loading, error, available, ensureRange, ensureAll, makeQueue, refresh, checkForUpdates, canCheckForUpdates, retry } = useLazyPlaylist(playlist, initialTracks)
  const canRefresh = playlist.type !== 'album' && !initialTracks?.length
  const refreshPlaylist = useCallback(async () => {
    if (!canRefresh || refreshInFlight.current) return
    refreshInFlight.current = true
    setRefreshing(true)
    setRefreshError(false)
    try {
      await refresh()
    } catch {
      setRefreshError(true)
    } finally {
      refreshInFlight.current = false
      setRefreshing(false)
    }
  }, [canRefresh, refresh])
  const checkPlaylist = useCallback(async () => {
    if (!canRefresh || checkInFlight.current || refreshInFlight.current) return
    checkInFlight.current = true
    try {
      await checkForUpdates()
    } catch {
      // 自动检查失败时保留现有歌曲；下次回到前台或定时检查会重试。
    } finally {
      checkInFlight.current = false
    }
  }, [canRefresh, checkForUpdates])
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
  const displayPlaylist = mergeAlbumDetail(playlist, albumDetail)
  const selectionQueue = useMemo(() => selecting ? makeQueue() : [], [selecting, tracks, total])
  const selectedTracks = selectionQueue.filter((track) => selected.has(String(track.id)))
  useEffect(() => { setSelecting(false); setSelected(new Set()) }, [playlist.id, playlist.source])
  useEffect(() => { setSelected(new Set()) }, [query])
  const toggleSelection = (track: Track) => setSelected((current) => {
    const next = new Set(current)
    const id = String(track.id)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  const displayCover = displayPlaylist.cover || tracks.find((track) => track?.cover)?.cover || ''

  useEffect(() => {
    let cancelled = false
    setAlbumDetail(null)
    if (!available || playlist.type !== 'album' || !service.getAlbumDetail) return () => { cancelled = true }
    void service.getAlbumDetail(playlist.id)
      .then((detail) => { if (!cancelled && detail) setAlbumDetail(detail) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [available, playlist.id, playlist.source, playlist.type, service])

  // 平台一旦停止参与，立即退出其详情页；避免保留来源标识、重试按钮等失效交互。
  useEffect(() => {
    if (!available) useNavigationStore.getState().goBack()
  }, [available])

  // 进入/切换详情时重置滚动渐变遮罩
  useEffect(() => {
    setTopOpacity(0)
    setBottomOpacity(0)
  }, [playlist, setTopOpacity, setBottomOpacity])

  // 歌单封面模糊后作为全局背景(铺满整个应用);离开详情页时清空
  useEffect(() => {
    if (active) return useBackdropStore.getState().setCover(displayCover)
  }, [active, displayCover])

  function playAt(index: number) {
    usePlaylistStore.getState().setQueue(makeQueue(), index, playlist.id)
  }

  if (!available) return null

  return (
    <motion.div layoutScroll className={styles.page} ref={pageRef} onScroll={handleScroll}>
      <div className="topGradient" style={{ opacity: topOpacity }} />
      <div className={styles.inner}>
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
              transition={isAlbum ? albumCoverTransition : springGentle}
              style={{ borderRadius: isAlbum ? 16 : 12 }}
            >
              {displayCover
                ? <img src={sizedImage(displayCover, isAlbum ? 512 : 176)} alt="" />
                : <PlaylistCoverFallback name={displayPlaylist.name} source={displayPlaylist.source} />}
            </motion.div>
            <motion.div variants={fadeRise} initial="hidden" animate="visible" transition={{ ...springGentle, delay: 0.15 }}>
              <h1 className={styles.detailTitle}>
                <GradientText>{displayPlaylist.name}</GradientText>
              </h1>
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
              {displayPlaylist.type === 'album' && displayPlaylist.description && (
                <p className={styles.detailDescription}>{displayPlaylist.description}</p>
              )}
            </motion.div>
          </div>
        </div>
        {!selecting && <BatchTrackActions label={isAlbum ? '整张专辑' : '整个歌单'} tracks={[]} collections={loading || error ? [] : [displayPlaylist]} />}
        <div className={styles.selectionControls}>
          <button type="button" disabled={loading || error} onClick={() => { setSelecting(!selecting); setSelected(new Set()) }}>{selecting ? '退出多选' : '多选歌曲'}</button>
          {selecting && <><button type="button" onClick={() => setSelected(new Set(selectionQueue.filter((track, index) => track.playable !== false && (!searching || matches.includes(index))).map((track) => String(track.id))))}>全选当前列表</button><button type="button" onClick={() => setSelected(new Set())}>清空选择</button></>}
        </div>
        {selecting && <BatchTrackActions tracks={selectedTracks} onDone={() => setSelected(new Set())} />}
        <TrackSearch
          value={query}
          onChange={setQuery}
          placeholder={isAlbum ? "搜索专辑内的歌曲或歌手" : "搜索歌单内的歌曲或歌手"}
          count={searching ? matches.length : total}
          loading={searchLoading || loading}
          error={searchError}
          onRetry={() => setSearchAttempt((value) => value + 1)}
        />
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
                  return <div className={styles.selectableRow} data-selected={selected.has(String(item.id))}>
                    <input type="checkbox" aria-label={`选择歌曲：${item.pending ? `第 ${i + 1} 首` : item.name}`} checked={selected.has(String(item.id))} disabled={item.playable === false} onChange={() => toggleSelection(item)} />
                    {t ? <TrackRow track={t} hideCover={isAlbum} hideOfflineAction index={i} onPlay={() => toggleSelection(item)} /> : <SkeletonTrackRow index={i} hideCover={isAlbum} />}
                  </div>
                }
                return t ? <TrackRow track={t} hideCover={isAlbum} index={i} onPlay={() => playAt(originalIndex)} /> : <SkeletonTrackRow index={i} hideCover={isAlbum} />
              }}
            />
          </motion.div>
        )}
      </div>
      <div className="bottomGradient" style={{ opacity: bottomOpacity }} />
    </motion.div>
  )
}
