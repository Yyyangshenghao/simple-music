import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { usePlaylistStore } from '../../stores/playlist'
import { usePlayerStore } from '../../stores/player'
import { useSettingsStore } from '../../stores/settings'
import { useToastStore } from '../../stores/toast'
import { tapScale, springSnappy, springGentle } from '../../lib/motion-presets'
import { queueDisplayOrder } from '../../lib/queue-display'
import { VirtualList } from '../ui/VirtualList'
import { SourceBadge } from '../ui/SourceBadge'
import { EqIndicator } from '../ui/EqIndicator'
import { QueueDiscovery } from './QueueDiscovery'
import { useProviderStore } from '../../stores/providers'
import { providerFor } from '../../providers/registry'
import { qqRelatedSongId } from '../../lib/qq-related-identifiers'
import { isProviderId } from '../../providers/types'
import { anchorOf, useTrackActionsStore } from '../../stores/track-actions'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import { useQueueDrag } from './useQueueDrag'
import styles from './QueuePanel.module.css'

/** 固定行高:VirtualList 要求,正常行与 pending skeleton 行一致 */
const ROW_HEIGHT = 48

function QueueIcon() {
  return (
    <svg viewBox="0 0 24 24" width="19" height="19" fill="currentColor" aria-hidden="true">
      <path d="M3 6h13v2H3zM3 11h13v2H3zM3 16h9v2H3zM19 6v8.35A3.5 3.5 0 1 0 21 17.5V8h2V6z" />
    </svg>
  )
}

/** 播放队列按钮 + 弹层：锚定在播放栏上方,展示当前队列,高亮当前曲目,点击切歌。 */
export function QueuePanel({ align = 'end' }: { align?: 'start' | 'end' }) {
  const [open, setOpen] = useState(false)
  const queue = usePlaylistStore((s) => s.queue)
  const queueIndex = usePlaylistStore((s) => s.queueIndex)
  const shuffleOrder = usePlaylistStore((s) => s.shuffleOrder)
  const playAt = usePlaylistStore((s) => s.playAt)
  const moveQueueItem = usePlaylistStore((s) => s.moveQueueItem)
  const playNextInQueue = usePlaylistStore((s) => s.playNextInQueue)
  const removeQueueItem = usePlaylistStore((s) => s.removeQueueItem)
  const clearQueue = usePlaylistStore((s) => s.clearQueue)
  const ensureQueueDetails = usePlaylistStore((s) => s.ensureQueueDetails)
  const playMode = useSettingsStore((s) => s.playMode)
  const isPlaying = usePlayerStore((s) => s.status === 'playing')
  const currentTrack = usePlayerStore((s) => s.currentTrack)
  const providers = useProviderStore((s) => s.byId)
  const qqAvailable = useProviderStore((s) => s.byId.qq.enabled && s.byId.qq.auth === 'authenticated')
  const discoverySongId = qqRelatedSongId(currentTrack)
  const canDiscover = qqAvailable && discoverySongId !== null
    && !!providerFor('qq').catalog.getSimilarTracks && !!providerFor('qq').catalog.getRelatedPlaylists
  const rootRef = useRef<HTMLDivElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const slitRef = useRef<HTMLDivElement>(null)
  const reducedMotion = useReducedMotion()
  const display = useMemo(
    () => queueDisplayOrder(queue.length, queueIndex, shuffleOrder, playMode),
    [playMode, queue.length, queueIndex, shuffleOrder]
  )
  const loadVisibleDetails = useCallback((start: number, end: number) => {
    const indices = display.indices.slice(start, end).filter((index) => {
      const track = queue[index]
      return track?.pending && (!isProviderId(track.source)
        || (providers[track.source].enabled && providers[track.source].auth === 'authenticated'))
    })
    void ensureQueueDetails(indices)
  }, [display.indices, ensureQueueDetails, providers, queue])

  const keyAt = (displayIndex: number) => {
    const track = queue[display.indices[displayIndex]]
    return track ? `${track.source}:${String(track.id)}` : ''
  }
  const { drag, onRowPointerDown, rowShift, ghost, strips } = useQueueDrag({
    panelRef, listRef, slitRef, total: display.indices.length, rowHeight: ROW_HEIGHT, reducedMotion,
    canShred: (i) => display.indices[i] !== queueIndex,
    onMove: (from, to) => moveQueueItem(from, to, { from: keyAt(from), to: keyAt(to) }),
    onShred: (i) => removeQueueItem(display.indices[i], keyAt(i)),
  })

  // Esc 关闭 + 点击弹层/按钮之外关闭
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      setOpen(false)
      if (rootRef.current?.contains(document.activeElement)) toggleRef.current?.focus()
    }
    function onPointerDown(e: PointerEvent) {
      if (e.target instanceof Element && e.target.closest('[data-track-action-layer]')) return
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
  // VirtualList 只渲染可视区行,不可见行不在 DOM,scrollIntoView 失效,
  // 改为直接计算滚动容器 scrollTop 定位到当前曲目居中
  useEffect(() => {
    if (!open || !listRef.current || queue.length === 0) return
    const el = listRef.current
    const target = display.currentDisplayIndex * ROW_HEIGHT + ROW_HEIGHT / 2 - el.clientHeight / 2
    el.scrollTop = Math.max(0, target)
  }, [display.currentDisplayIndex, display.indices.length, open])

  return (
    <div className={styles.root} ref={rootRef}>
      <motion.button
        ref={toggleRef}
        type="button"
        className={`${styles.toggleBtn} no-drag`}
        data-active={open}
        onClick={() => setOpen((v) => !v)}
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
            ref={panelRef}
            className={`${styles.panel}${align === 'start' ? ` ${styles.alignStart}` : ''}`}
            // 缩放会让虚拟列表的视口坐标与 scrollTop 不一致，深队列打开时出现空白。
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={springGentle}
          >
            <div className={styles.header}>
              <span className={styles.title}>播放队列</span>
              <span className={styles.count}>{queue.length} 首</span>
              <button type="button" className={styles.clearBtn} disabled={!queue.length}
                title="清空队列并停止播放" aria-label="清空播放队列并停止播放"
                onClick={() => {
                  clearQueue()
                  useToastStore.getState().show('已清空播放队列')
                }}>清空</button>
            </div>
            <div className={styles.list} ref={listRef}>
              {queue.length === 0 ? (
                <div className={styles.empty}>队列为空</div>
              ) : (
                <VirtualList
                  total={display.indices.length}
                  rowHeight={ROW_HEIGHT}
                  scrollRef={listRef}
                  onRangeChange={loadVisibleDetails}
                  renderRow={(i) => {
                    const originalIndex = display.indices[i]
                    const t = queue[originalIndex]
                    const isCurrent = originalIndex === queueIndex
                    return (
                      <div
                        className={styles.row}
                        data-current={isCurrent}
                        data-reordering={drag ? true : undefined}
                        data-drag-placeholder={drag?.from === i || undefined}
                        style={drag ? { transform: `translateY(${rowShift(i)}px)` } : undefined}
                        onPointerDown={(event) => onRowPointerDown(i, event)}
                      >
                        <button
                          type="button"
                          className={styles.rowMain}
                          onClick={() => { if (!isCurrent) playAt(originalIndex, { expectedTrackKey: `${t.source}:${String(t.id)}` }) }}
                          onKeyDown={(event) => {
                            if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
                            event.preventDefault()
                            const target = i + (event.key === 'ArrowUp' ? -1 : 1)
                            if (target < 0 || target >= display.indices.length) return
                            const targetTrack = queue[display.indices[target]]
                            moveQueueItem(i, target, { from: `${t.source}:${String(t.id)}`, to: `${targetTrack.source}:${String(targetTrack.id)}` })
                            requestAnimationFrame(() => {
                              listRef.current?.querySelector<HTMLButtonElement>(`[data-queue-display-index="${target}"]`)?.focus()
                            })
                          }}
                          data-queue-display-index={i}
                          title={`${t.name} · 拖动或 Alt + ↑/↓ 调整顺序，拖到底部移除`}
                          aria-label={isCurrent ? `正在播放 ${t.name}` : `播放 ${t.name}`}
                        >
                          <span className={styles.index}>
                            {isCurrent ? (
                              <EqIndicator paused={!isPlaying} />
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
                          <SourceBadge source={t.source} compact />
                        </button>
                        <button type="button" className={styles.rowAction} data-queue-no-drag
                          data-track-action-trigger aria-haspopup="dialog"
                          title="加入歌单" aria-label={`将 ${t.name} 加入歌单`}
                          onClick={event => useTrackActionsStore.getState().toggleQuickAdd(t, anchorOf(event.currentTarget))}>
                          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
                        </button>
                        {!isCurrent && (
                          <>
                            <button type="button" className={styles.rowAction} data-queue-no-drag
                              disabled={playMode === 'one'}
                              title={playMode === 'one' ? '单曲循环时不会自动切歌' : '设为下一首'}
                              aria-label={`将 ${t.name} 设为下一首`}
                              onClick={() => playNextInQueue(originalIndex, `${t.source}:${String(t.id)}`)}>下一首</button>
                            <button type="button" className={styles.rowAction} data-queue-no-drag
                              title="从队列移除" aria-label={`从队列移除 ${t.name}`}
                              onClick={() => removeQueueItem(originalIndex, `${t.source}:${String(t.id)}`)}>×</button>
                          </>
                        )}
                      </div>
                    )
                  }}
                />
              )}
            </div>
            <AnimatePresence>
              {drag && (
                <motion.div
                  className={styles.shredSlot}
                  data-over={drag.overSlit || undefined}
                  data-blocked={!drag.canShred || undefined}
                  initial={{ x: 40, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  exit={{ x: 40, opacity: 0 }}
                  transition={springSnappy}
                >
                  <div ref={slitRef} className={styles.shredSlit} aria-hidden="true" />
                  <span className={styles.shredHint}>{drag.canShred ? (drag.overSlit ? '松手移除' : '拖到此处移除') : '播放中不可移除'}</span>
                </motion.div>
              )}
            </AnimatePresence>
            {ghost}
            {strips}
            {open && canDiscover && currentTrack && (
              <QueueDiscovery key={`${currentTrack.source}:${String(currentTrack.id)}:${discoverySongId}`}
                track={currentTrack} onOpenPlaylist={() => setOpen(false)} />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
