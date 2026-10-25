import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { usePlaylistStore } from '../../stores/playlist'
import { usePlayerStore } from '../../stores/player'
import { useSettingsStore } from '../../stores/settings'
import { useToastStore } from '../../stores/toast'
import { tapScale, springSnappy, springGentle, queueRowFlashTiming, queueRowFlipTiming, queueRowRemoveTiming } from '../../lib/motion-presets'
import { queueDisplayOrder } from '../../lib/queue-display'
import { VirtualList } from '../ui/VirtualList'
import { SourceBadge } from '../ui/SourceBadge'
import { EqIndicator } from '../ui/EqIndicator'
import { HoverTips } from '../ui/HoverTips'
import { QueueDiscovery } from './QueueDiscovery'
import { useProviderStore } from '../../stores/providers'
import { providerFor } from '../../providers/registry'
import { qqRelatedSongId } from '../../lib/qq-related-identifiers'
import { isProviderId } from '../../providers/types'
import { anchorOf, useTrackActionsStore } from '../../stores/track-actions'
import { useMotion } from '../../hooks/useMotion'
import { useQueueDrag } from './useQueueDrag'
import styles from './QueuePanel.module.css'

/** 固定行高:VirtualList 要求,正常行与 pending skeleton 行一致 */
const ROW_HEIGHT = 48
/** 重排补间最多从几行外滑入，远处移来的歌曲不必横穿整个列表。 */
const FLIP_MAX_ROWS = 6

const trackKeyOf = (track: { source: string; id: unknown }) => `${track.source}:${String(track.id)}`

function QueueIcon() {
  return (
    <svg viewBox="0 0 24 24" width="19" height="19" fill="currentColor" aria-hidden="true">
      <path d="M3 6h13v2H3zM3 11h13v2H3zM3 16h9v2H3zM19 6v8.35A3.5 3.5 0 1 0 21 17.5V8h2V6z" />
    </svg>
  )
}

/** 设为下一首：播放三角插在列表最上方；悬停时三角向前轻推。 */
function PlayNextIcon() {
  return (
    <svg className={styles.playNextIcon} viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path className={styles.playNextTriangle} d="M4 4.5v6l5-3z" fill="currentColor" />
      <path className={styles.playNextLead} d="M13 7.5h7" />
      <path d="M4 14h16M4 19h16" />
    </svg>
  )
}

/** 从队列移除：悬停时叉号转四分之一圈。 */
function RemoveIcon() {
  return (
    <svg className={styles.removeIcon} viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" />
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
  const reducedMotion = !useMotion('pageTransitionMotion')
  // 拖拽倾斜、抬升与碎纸属于控件手感，与列表补位过渡分开控制。
  const dragStill = !useMotion('dragMotion')
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

  // 设为下一首 / 移除后的重排补间（FLIP）：操作前记下各曲目所在行，重排提交后让各行从原位滑到新位置。
  const flipFrom = useRef<{ positions: Map<string, number>; flashKey?: string; cleanup?: () => void } | null>(null)
  const snapshotPositions = (flashKey?: string, cleanup?: () => void) => {
    const positions = new Map<string, number>()
    display.indices.forEach((queueIndexAt, row) => {
      const track = queue[queueIndexAt]
      if (track && !positions.has(trackKeyOf(track))) positions.set(trackKeyOf(track), row)
    })
    flipFrom.current = { positions, flashKey, cleanup }
  }
  useLayoutEffect(() => {
    const flip = flipFrom.current
    const list = listRef.current
    if (!flip || !list) return
    flipFrom.current = null
    flip.cleanup?.()
    if (reducedMotion) return
    const ambient = getComputedStyle(list).getPropertyValue('--ambient-1').trim() || 'currentColor'
    list.querySelectorAll<HTMLElement>('[data-queue-key]').forEach((row) => {
      const key = row.dataset.queueKey!
      const before = flip.positions.get(key)
      const now = Number(row.dataset.queueRow)
      if (before !== undefined && before !== now) {
        const delta = Math.max(-FLIP_MAX_ROWS, Math.min(FLIP_MAX_ROWS, before - now)) * ROW_HEIGHT
        row.animate([{ transform: `translateY(${delta}px)` }, { transform: 'none' }], queueRowFlipTiming)
      }
      if (key === flip.flashKey) {
        row.animate([
          { backgroundColor: `color-mix(in srgb, ${ambient} 30%, transparent)` },
          { backgroundColor: `color-mix(in srgb, ${ambient} 0%, transparent)` },
        ], { ...queueRowFlashTiming, delay: Number(queueRowFlipTiming.duration) * 0.6 })
      }
    })
  }, [queue, display, reducedMotion])

  const playNextWithAnimation = (originalIndex: number, key: string) => {
    snapshotPositions(key)
    playNextInQueue(originalIndex, key)
  }
  /** 移除：该行先向左滑出淡掉，再提交移除并让下方各行补位；减弱动态时直接移除。 */
  const removeWithAnimation = (row: HTMLElement | null, originalIndex: number, key: string) => {
    if (reducedMotion || !row) {
      snapshotPositions()
      removeQueueItem(originalIndex, key)
      return
    }
    row.style.pointerEvents = 'none'
    const leaving = row.animate(
      [{ transform: 'none', opacity: 1 }, { transform: 'translateX(-28px)', opacity: 0 }],
      { ...queueRowRemoveTiming, fill: 'forwards' }
    )
    // 定格的淡出要等重排提交后再撤（否则移除前会闪回一帧）；移除被拒时稍后自行恢复。
    const restore = () => { leaving.cancel(); row.style.pointerEvents = '' }
    void leaving.finished.then(() => {
      snapshotPositions(undefined, restore)
      removeQueueItem(originalIndex, key)
      setTimeout(() => { if (flipFrom.current?.cleanup === restore) { flipFrom.current = null; restore() } }, 120)
    }, restore)
  }

  const keyAt = (displayIndex: number) => {
    const track = queue[display.indices[displayIndex]]
    return track ? `${track.source}:${String(track.id)}` : ''
  }
  const { drag, onRowPointerDown, rowShift, ghost, strips } = useQueueDrag({
    panelRef, listRef, slitRef, total: display.indices.length, rowHeight: ROW_HEIGHT, reducedMotion: dragStill,
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
                        data-queue-key={trackKeyOf(t)}
                        data-queue-row={i}
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
                          data-tip="加入歌单" aria-label={`将 ${t.name} 加入歌单`}
                          onClick={event => useTrackActionsStore.getState().toggleQuickAdd(t, anchorOf(event.currentTarget))}>
                          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
                        </button>
                        {!isCurrent && (
                          <>
                            <button type="button" className={styles.rowAction} data-queue-no-drag
                              disabled={playMode === 'one'}
                              data-tip="下一首播放"
                              title={playMode === 'one' ? '单曲循环时不会自动切歌' : undefined}
                              aria-label={`将 ${t.name} 设为下一首`}
                              onClick={() => playNextWithAnimation(originalIndex, trackKeyOf(t))}>
                              <PlayNextIcon />
                            </button>
                            <button type="button" className={styles.rowAction} data-queue-no-drag
                              data-tip="从队列移除" aria-label={`从队列移除 ${t.name}`}
                              onClick={(event) => removeWithAnimation(event.currentTarget.closest<HTMLElement>('[data-queue-key]'), originalIndex, trackKeyOf(t))}>
                              <RemoveIcon />
                            </button>
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
            {!drag && <HoverTips match="button[data-tip]" />}
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
