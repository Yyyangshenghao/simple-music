import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useMusicService } from '../../hooks/useMusicService'
import { usePlaylistStore } from '../../stores/playlist'
import { springGentle } from '../../lib/motion-presets'
import type { Playlist, Track } from '../../types/domain'
import styles from './PlaylistPreviewModal.module.css'

interface PlaylistPreviewModalProps {
  playlist: Playlist | null
  onClose(): void
}

/** Stack 顶卡的小卡预览：简介 + 可滚动曲目，不跳详情页。 */
export function PlaylistPreviewModal({ playlist, onClose }: PlaylistPreviewModalProps) {
  const service = useMusicService()
  const [tracks, setTracks] = useState<Track[]>([])
  const [loading, setLoading] = useState(false)

  // 打开时才拉曲目；快速开合时丢弃过期响应
  useEffect(() => {
    if (!playlist) return
    let cancelled = false
    setTracks([])
    setLoading(true)
    service.getPlaylistDetail(playlist.id)
      .then((ts) => { if (!cancelled) setTracks(ts) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [playlist, service])

  useEffect(() => {
    if (!playlist) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [playlist, onClose])

  function playAll() {
    if (tracks.length === 0) return
    usePlaylistStore.getState().setQueue(tracks, 0)
    onClose()
  }

  function playTrack(index: number) {
    usePlaylistStore.getState().setQueue(tracks, index)
  }

  return (
    <AnimatePresence>
      {playlist && (
        <motion.div
          className={styles.overlay}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className={styles.panel}
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.96 }}
            transition={springGentle}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.header}>
              {playlist.cover
                ? <img className={styles.cover} src={playlist.cover} alt="" />
                : <div className={styles.cover} />}
              <div className={styles.meta}>
                <h3 className={styles.name}>{playlist.name}</h3>
                {playlist.description && <p className={styles.desc}>{playlist.description}</p>}
              </div>
              <button className={styles.closeBtn} onClick={onClose} aria-label="关闭">✕</button>
            </div>
            <div className={styles.actions}>
              <button className={styles.playAll} onClick={playAll} disabled={tracks.length === 0}>▶ 播放全部</button>
              <span className={styles.count}>{loading ? '加载中…' : `${tracks.length} 首`}</span>
            </div>
            <div className={styles.list}>
              {tracks.map((t, i) => (
                <button key={`${String(t.id)}-${i}`} className={styles.row} onClick={() => playTrack(i)}>
                  <span className={styles.index}>{i + 1}</span>
                  <span className={styles.rowText}>
                    <span className={styles.rowName}>{t.name}</span>
                    <span className={styles.rowArtist}>{t.artist}</span>
                  </span>
                </button>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
