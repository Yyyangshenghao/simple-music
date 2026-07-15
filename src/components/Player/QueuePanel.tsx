import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { usePlaylistStore } from '../../stores/playlist'
import { usePlayerStore } from '../../stores/player'
import { tapScale, springSnappy, springGentle } from '../../lib/motion-presets'
import styles from './QueuePanel.module.css'

function QueueIcon() {
  return (
    <svg viewBox="0 0 24 24" width="19" height="19" fill="currentColor" aria-hidden="true">
      <path d="M3 6h13v2H3zM3 11h13v2H3zM3 16h9v2H3zM19 6v8.35A3.5 3.5 0 1 0 21 17.5V8h2V6z" />
    </svg>
  )
}

/** 播放队列按钮 + 弹层：锚定在播放栏上方,展示当前队列,高亮当前曲目,点击切歌。 */
export function QueuePanel() {
  const [open, setOpen] = useState(false)
  const queue = usePlaylistStore((s) => s.queue)
  const queueIndex = usePlaylistStore((s) => s.queueIndex)
  const playAt = usePlaylistStore((s) => s.playAt)
  const isPlaying = usePlayerStore((s) => s.status === 'playing')
  const rootRef = useRef<HTMLDivElement>(null)
  const currentRowRef = useRef<HTMLButtonElement>(null)

  // Esc 关闭 + 点击弹层/按钮之外关闭
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    function onPointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointerDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open])

  // 打开时把当前曲目滚到可视区中间
  useEffect(() => {
    if (open) currentRowRef.current?.scrollIntoView({ block: 'center' })
  }, [open])

  return (
    <div className={styles.root} ref={rootRef}>
      <motion.button
        type="button"
        className={`${styles.toggleBtn} no-drag`}
        data-active={open}
        onClick={() => setOpen((v) => !v)}
        title="播放队列"
        aria-label="播放队列"
        aria-expanded={open}
        whileTap={tapScale}
        transition={springSnappy}
      >
        <QueueIcon />
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            className={styles.panel}
            initial={{ opacity: 0, y: 12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.97 }}
            transition={springGentle}
          >
            <div className={styles.header}>
              <span className={styles.title}>播放队列</span>
              <span className={styles.count}>{queue.length} 首</span>
            </div>
            <div className={styles.list}>
              {queue.length === 0 && <div className={styles.empty}>队列为空</div>}
              {queue.map((t, i) => {
                const isCurrent = i === queueIndex
                return (
                  <button
                    key={`${String(t.id)}-${i}`}
                    ref={isCurrent ? currentRowRef : undefined}
                    className={styles.row}
                    data-current={isCurrent}
                    onClick={() => {
                      if (!isCurrent) playAt(i)
                    }}
                  >
                    <span className={styles.index}>
                      {isCurrent ? (
                        <span className={styles.playingDot} data-playing={isPlaying} aria-hidden="true" />
                      ) : (
                        i + 1
                      )}
                    </span>
                    <span className={styles.rowText}>
                      {t.pending ? (
                        <span className={styles.rowSkeleton} aria-hidden="true">
                          <i />
                          <i />
                        </span>
                      ) : (
                        <>
                          <span className={styles.rowName}>{t.name}</span>
                          <span className={styles.rowArtist}>{t.artist}</span>
                        </>
                      )}
                    </span>
                  </button>
                )
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
