import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import type { Variants } from 'motion/react'
import { useLazyPlaylist } from '../../hooks/useLazyPlaylist'
import { usePlaylistStore } from '../../stores/playlist'
import { useNavigationStore } from '../../stores/navigation'
import { albumCoverTransition, springGentle } from '../../lib/motion-presets'
import { CloseIcon } from '../ui/CloseIcon'
import { SourceBadge } from '../ui/SourceBadge'
import type { Playlist } from '../../types/domain'
import styles from './PlaylistPreviewModal.module.css'
import { sizedImage } from '../../lib/image-size'
import { PlaylistCoverFallback } from '../ui/PlaylistCoverFallback'
import { QQLikedCoverOverlay } from '../ui/QQLikedCoverOverlay'

interface PlaylistPreviewModalProps {
  playlist: Playlist | null
  onClose(): void
}

const overlayVariants: Variants = {
  exit: (openingDetail: boolean) => ({ opacity: 0, ...(openingDetail ? { transition: { duration: 0 } } : {}) }),
}

/** 面板内容：拆出来保证 useLazyPlaylist 拿到非空 playlist（与详情页共用缓存，进详情零请求）。 */
function PreviewPanel({ playlist, onClose }: { playlist: Playlist; onClose(): void }) {
  const { total, tracks, loading, error, makeQueue } = useLazyPlaylist(playlist)
  const displayCover = playlist.cover || tracks.find((track) => track?.cover)?.cover || ''

  function playAll() {
    if (total === 0) return
    usePlaylistStore.getState().setQueue(makeQueue(), 0, playlist.id)
    onClose()
  }

  function playTrack(index: number) {
    usePlaylistStore.getState().setQueue(makeQueue(), index, playlist.id)
  }

  function openDetail() {
    if (total === 0) return
    useNavigationStore.getState().navigateTo({ type: 'playlist', from: 'explore', playlist })
    onClose()
  }

  return (
    <motion.div
      className={styles.panel}
      initial={{ opacity: 0, y: 24, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 24, scale: 0.96 }}
      transition={springGentle}
      onClick={(e) => e.stopPropagation()}
    >
      <div className={styles.header}>
        <motion.div className={styles.cover}
          layoutId={playlist.type === 'album' ? `album-cover-${playlist.source}-${String(playlist.id)}` : `explore-cover-${String(playlist.id)}`}
          layoutCrossfade={false}
          transition={playlist.type === 'album' ? albumCoverTransition : springGentle}
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
        <button className={styles.playAll} onClick={playAll} disabled={total === 0}>▶ 播放全部</button>
        <button className={styles.openBtn} onClick={openDetail} disabled={total === 0}>{playlist.type === 'album' ? '进入专辑' : '进入歌单'}</button>
        <span className={styles.count}>{loading ? '加载中…' : `${total} 首`}</span>
      </div>
      <div className={styles.list} aria-busy={loading}>
        {loading && <div role="status" aria-label="正在加载歌曲">
          {Array.from({ length: 6 }, (_, index) => <div className={styles.skeletonRow} key={index} aria-hidden="true">
            <span className={styles.skeletonIndex} />
            <span className={styles.skeletonText}><i /><i /></span>
          </div>)}
        </div>}
        {!loading && !tracks.some(Boolean) && <p className={styles.empty}>
          {error ? '歌曲暂时无法加载，请稍后重新打开' : '暂无可预览的歌曲'}
        </p>}
        {/* 预览只展示已加载详情的前缀批次；完整列表进详情页看 */}
        {tracks.map((t, i) =>
          t ? (
            <button key={`${String(t.id)}-${i}`} className={styles.row} onClick={() => playTrack(i)}>
              <span className={styles.index}>{i + 1}</span>
              <span className={styles.rowText}>
                <span className={styles.rowName}>{t.name}</span>
                <span className={styles.rowArtist}>{t.artist}</span>
              </span>
              <SourceBadge source={t.source} compact />
            </button>
          ) : null
        )}
      </div>
    </motion.div>
  )
}

/** 歌单和专辑小卡预览：简介 + 可滚动曲目，可播放全部或进入完整详情页。 */
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
          <PreviewPanel playlist={playlist} onClose={onClose} />
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
