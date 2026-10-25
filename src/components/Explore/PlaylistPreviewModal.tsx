import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import type { Variants } from 'motion/react'
import { loadPlaylistQueue, useLazyPlaylist } from '../../hooks/useLazyPlaylist'
import { PREVIEW_PAGE_SIZE, usePlaylistPreview } from '../../hooks/usePlaylistPreview'
import { serviceFor } from '../../lib/service-registry'
import { usePlaylistStore } from '../../stores/playlist'
import { useNavigationStore } from '../../stores/navigation'
import { albumCoverTransition, springGentle } from '../../lib/motion-presets'
import { CloseIcon } from '../ui/CloseIcon'
import { SourceBadge } from '../ui/SourceBadge'
import type { Playlist, Track } from '../../types/domain'
import styles from './PlaylistPreviewModal.module.css'
import { sizedImage } from '../../lib/image-size'
import { PlaylistCoverFallback } from '../ui/PlaylistCoverFallback'
import { QQLikedCoverOverlay } from '../ui/QQLikedCoverOverlay'
import { usePageTransition } from '../../hooks/useMotion'

interface PlaylistPreviewModalProps {
  playlist: Playlist | null
  onClose(): void
}

const overlayVariants: Variants = {
  exit: (openingDetail: boolean) => ({ opacity: 0, ...(openingDetail ? { transition: { duration: 0 } } : {}) }),
}

interface PreviewData {
  tracks: (Track | null)[]
  total: number
  loading: boolean
  loadingMore: boolean
  error: boolean
  moreError: boolean
  /** 正在为播放拉取完整队列。 */
  starting: boolean
  onReachEnd(): void
  onRetryMore(): void
  playAll(): void
  playTrack(index: number): void
}

/** 列表距底部不足此距离时预取下一页。 */
const LOAD_MORE_THRESHOLD_PX = 240

/** QQ / Apple Music:骨架要整单翻页,预览只按页取;播放时再拉整单(与详情页共用缓存)。 */
function PagedPreviewPanel({ playlist, onClose }: { playlist: Playlist; onClose(): void }) {
  const preview = usePlaylistPreview(playlist)
  const [starting, setStarting] = useState(false)
  const mountedRef = useRef(true)
  useEffect(() => () => { mountedRef.current = false }, [])

  async function startPlayback(index: number | null) {
    if (starting) return
    setStarting(true)
    try {
      const queue = await loadPlaylistQueue(playlist)
      if (!mountedRef.current || !queue.length) return
      const picked = index === null ? null : preview.tracks[index]
      const found = picked ? queue.findIndex((track) => String(track.id) === String(picked.id)) : 0
      usePlaylistStore.getState().setQueue(queue, Math.max(0, found), playlist.id)
      if (index === null) onClose()
    } catch {
      // 失败保持浮窗,用户可再点一次
    } finally {
      if (mountedRef.current) setStarting(false)
    }
  }

  return <PreviewPanelView playlist={playlist} onClose={onClose} data={{
    tracks: preview.tracks,
    total: preview.total,
    loading: preview.loading,
    loadingMore: preview.loadingMore,
    error: preview.error,
    moreError: preview.moreError,
    starting,
    onReachEnd: () => preview.loadMore(),
    onRetryMore: () => preview.loadMore(true),
    playAll: () => { void startPlayback(null) },
    playTrack: (index) => { void startPlayback(index) },
  }} />
}

/** 网易 / 本地 / 专辑:骨架本身只带前缀详情,滚动时按窗口补详情(与详情页共用缓存,进详情零请求)。 */
function LazyPreviewPanel({ playlist, onClose }: { playlist: Playlist; onClose(): void }) {
  const { total, tracks, loading, error, makeQueue, ensureRange } = useLazyPlaylist(playlist)
  // 下架曲目在骨架里是 null:按已加载条数推进窗口,null 不会卡住翻页
  const loaded = tracks.reduce((count, track) => track ? count + 1 : count, 0)

  function playTrack(index: number): boolean {
    const queue = makeQueue()
    if (!queue.length) return false
    usePlaylistStore.getState().setQueue(queue, index, playlist.id)
    return true
  }

  return <PreviewPanelView playlist={playlist} onClose={onClose} data={{
    tracks,
    total,
    loading,
    loadingMore: false,
    error,
    moreError: false,
    starting: false,
    onReachEnd: () => { if (loaded < total) ensureRange(0, loaded + PREVIEW_PAGE_SIZE) },
    onRetryMore: () => {},
    playAll: () => { if (total > 0 && playTrack(0)) onClose() },
    playTrack: (index) => { playTrack(index) },
  }} />
}

function PreviewPanelView({ playlist, onClose, data }: { playlist: Playlist; onClose(): void; data: PreviewData }) {
  const pageTransition = usePageTransition()
  const { tracks, total, loading, loadingMore, error, moreError, starting } = data
  const displayCover = playlist.cover || tracks.find((track) => track?.cover)?.cover || ''

  function openDetail() {
    if (total === 0) return
    useNavigationStore.getState().navigateTo({ type: 'playlist', from: 'explore', playlist })
    onClose()
  }

  function onListScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget
    if (el.scrollHeight - el.scrollTop - el.clientHeight < LOAD_MORE_THRESHOLD_PX) data.onReachEnd()
  }

  return (
    <motion.div
      className={styles.panel}
      initial={{ opacity: 0, y: 24, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 24, scale: 0.96 }}
      transition={pageTransition(springGentle)}
      onClick={(e) => e.stopPropagation()}
    >
      <div className={styles.header}>
        <motion.div className={styles.cover}
          layoutId={playlist.type === 'album' ? `album-cover-${playlist.source}-${String(playlist.id)}` : `explore-cover-${String(playlist.id)}`}
          layoutCrossfade={false}
          transition={pageTransition(playlist.type === 'album' ? albumCoverTransition : springGentle)}
          style={{ borderRadius: 12 }}>
          {displayCover
            ? <img src={sizedImage(displayCover, 176)} alt="" />
            : <PlaylistCoverFallback name={playlist.name} source={playlist.source} />}
          {displayCover && <QQLikedCoverOverlay playlist={playlist} />}
        </motion.div>
        <div className={styles.meta}>
          <h3 className={styles.name}>{playlist.name}</h3>
          <SourceBadge source={playlist.source} reveal />
          {playlist.description && <p className={styles.desc}>{playlist.description}</p>}
        </div>
        <button className={styles.closeBtn} onClick={onClose} aria-label="关闭"><CloseIcon size={14} /></button>
      </div>
      <div className={styles.actions}>
        <button className={styles.playAll} onClick={data.playAll} disabled={total === 0 || starting}>▶ 播放全部</button>
        <button className={styles.openBtn} onClick={openDetail} disabled={total === 0}>{playlist.type === 'album' ? '进入专辑' : '进入歌单'}</button>
        <span className={styles.count}>{loading ? '加载中…' : starting ? '正在准备播放…' : `${total} 首`}</span>
      </div>
      <div className={styles.list} aria-busy={loading} onScroll={onListScroll}>
        {loading && <div role="status" aria-label="正在加载歌曲">
          {Array.from({ length: 6 }, (_, index) => <div className={styles.skeletonRow} key={index} aria-hidden="true">
            <span className={styles.skeletonIndex} />
            <span className={styles.skeletonText}><i /><i /></span>
          </div>)}
        </div>}
        {!loading && !tracks.some(Boolean) && <p className={styles.empty}>
          {error ? '歌曲暂时无法加载，请稍后重新打开' : '暂无可预览的歌曲'}
        </p>}
        {tracks.map((t, i) =>
          t ? (
            <div key={`${String(t.id)}-${i}`} className={styles.row}>
              <button type="button" className={styles.rowMain} onClick={() => data.playTrack(i)} disabled={starting}>
                <span className={styles.index}>{i + 1}</span>
                <span className={styles.rowText}>
                  <span className={styles.rowName}>{t.name}</span>
                  <span className={styles.rowArtist}>{t.artist}</span>
                </span>
                <SourceBadge source={t.source} compact />
              </button>
            </div>
          ) : null
        )}
        {loadingMore && <p className={styles.more} role="status">加载更多…</p>}
        {moreError && <button type="button" className={styles.more} onClick={data.onRetryMore}>加载失败，点击重试</button>}
      </div>
    </motion.div>
  )
}

/** 歌单和专辑小卡预览：简介 + 可滚动曲目，只供浏览、播放或进入完整详情页。 */
export function PlaylistPreviewModal({ playlist, onClose }: PlaylistPreviewModalProps) {
  const openingDetail = useNavigationStore(state => typeof state.currentView === 'object' && state.currentView.type === 'playlist')
  useEffect(() => {
    if (!playlist) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [playlist, onClose])

  return createPortal(
    <AnimatePresence custom={openingDetail}>
      {playlist && (
        <motion.div
          className={styles.overlay}
          layoutRoot
          data-framer-portal-id="playlist-preview"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          variants={overlayVariants}
          exit="exit"
          onClick={onClose}
        >
          {playlist.type !== 'album' && serviceFor(playlist.source).getPlaylistPage
            ? <PagedPreviewPanel key={`${playlist.source}:${playlist.type}:${String(playlist.id)}`} playlist={playlist} onClose={onClose} />
            : <LazyPreviewPanel key={`${playlist.source}:${playlist.type}:${String(playlist.id)}`} playlist={playlist} onClose={onClose} />}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
