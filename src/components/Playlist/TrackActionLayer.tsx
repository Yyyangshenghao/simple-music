import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { usePlaylistStore } from '../../stores/playlist'
import { useToastStore } from '../../stores/toast'
import { placePopover, useTrackActionsStore, type PopoverAnchor } from '../../stores/track-actions'
import { resolveAppPlaylistTracks } from '../../lib/batch-tracks'
import type { Track } from '../../types/domain'
import { AddToPlaylistDialog } from './AddToPlaylistDialog'
import styles from './TrackActionLayer.module.css'

/** 定位、焦点与关闭规则：点外部、Esc、窗口尺寸变化或外部滚动即关闭，关闭后焦点回到触发处。 */
function Floating({ anchor, label, onClose, children }: { anchor: PopoverAnchor; label: string; onClose(): void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  const opener = useRef<Element | null>(null)

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const updatePosition = () => setPosition(placePopover(anchor, { width: element.offsetWidth, height: element.offsetHeight }, { width: window.innerWidth, height: window.innerHeight }))
    updatePosition()
    const observer = new ResizeObserver(updatePosition)
    observer.observe(element)
    return () => observer.disconnect()
  }, [anchor])

  useEffect(() => {
    opener.current = document.activeElement
    ref.current?.querySelector<HTMLElement>('button:not(:disabled), input')?.focus({ preventScroll: true })
    const inside = (target: EventTarget | null) => target instanceof Node && !!ref.current?.contains(target)
    // 触发按钮自行切换开关，避免按下时先关闭、点击时又重开。
    const onPointerDown = (event: PointerEvent) => {
      if (!inside(event.target) && !(event.target instanceof Element && event.target.closest('[data-track-action-trigger]'))) onClose()
    }
    const onScroll = (event: Event) => { if (!inside(event.target)) onClose() }
    const onFocus = (event: FocusEvent) => { if (!inside(event.target)) onClose() }
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onClose)
    window.addEventListener('focusin', onFocus)
    window.addEventListener('blur', onClose)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('focusin', onFocus)
      window.removeEventListener('blur', onClose)
      if (opener.current instanceof HTMLElement && opener.current.isConnected) opener.current.focus({ preventScroll: true })
    }
  }, [onClose])

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); return }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? [])
    if (!items.length) return
    event.preventDefault()
    const current = items.indexOf(document.activeElement as HTMLElement)
    items[(current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus()
  }

  return <div ref={ref} data-track-action-layer className={`${styles.floating} no-drag`} role="dialog" aria-label={label} onKeyDown={onKeyDown}
    onContextMenu={event => event.preventDefault()}
    style={position ? { left: position.left, top: position.top } : { left: anchor.x, top: anchor.y, visibility: 'hidden' }}>
    {children}
  </div>
}

function PlusIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
}

/** 单曲加入歌单：与多选共用同一弹窗；pending 歌曲先补全详情再保存。 */
function QuickAddDialog({ track, onClose }: { track: Track; onClose(): void }) {
  async function loadTracks(signal: AbortSignal) {
    if (!track.pending) return [track]
    const tracks = await resolveAppPlaylistTracks([track], [], signal)
    if (signal.aborted) return []
    if (!tracks.length) throw new Error('未能读取歌曲信息，请重试')
    // 平台漏回详情时保留可继续加载的占位，避免永久收藏空白曲名。
    return [tracks[0].name.trim() ? tracks[0] : { ...tracks[0], name: '待加载歌曲', pending: true }]
  }
  return <AddToPlaylistDialog tracks={[track]} contextLabel={[track.name || '当前歌曲', track.artist].filter(Boolean).join(' · ')} loadTracks={loadTracks} onClose={onClose} />
}

function TrackContextMenu({ track, anchor, onClose }: { track: Track; anchor: PopoverAnchor; onClose(): void }) {
  return <Floating anchor={anchor} label={`歌曲操作：${track.name}`} onClose={onClose}>
    <div className={styles.menu} role="menu">
      <button type="button" role="menuitem" onClick={() => useTrackActionsStore.getState().openQuickAdd(track, anchor)}>
        <PlusIcon />加入歌单…
      </button>
      <button type="button" role="menuitem" onClick={() => {
        usePlaylistStore.getState().addToQueue(track)
        useToastStore.getState().show('已添加到播放队列')
        onClose()
      }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M4 6h16M4 11h10M4 16h7m7-3v8m-4-4h8" /></svg>添加到播放队列
      </button>
    </div>
  </Floating>
}

/** 全局单曲操作层：右键菜单与加入歌单弹窗，挂在 App 根部，经 portal 逃离页面转场的 transform。 */
export function TrackActionLayer() {
  const quickAdd = useTrackActionsStore(state => state.quickAdd)
  const menu = useTrackActionsStore(state => state.menu)
  const close = useTrackActionsStore(state => state.close)
  if (!quickAdd && !menu) return null
  return createPortal(<>
    {menu && <TrackContextMenu key={`menu-${menu.anchor.x}-${menu.anchor.y}`} track={menu.track} anchor={menu.anchor} onClose={close} />}
    {quickAdd && <QuickAddDialog key={`add-${quickAdd.track.source}-${String(quickAdd.track.id)}-${quickAdd.anchor.x}-${quickAdd.anchor.y}`} track={quickAdd.track} onClose={close} />}
  </>, document.body)
}
