import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useAppPlaylistsStore } from '../../stores/app-playlists'
import { usePlaylistStore } from '../../stores/playlist'
import { useToastStore } from '../../stores/toast'
import {
  containsTrack, orderQuickAddTargets, placePopover, readLastTarget, rememberTarget, useTrackActionsStore, type PopoverAnchor,
} from '../../stores/track-actions'
import { resolveAppPlaylistTracks } from '../../lib/batch-tracks'
import type { Track } from '../../types/domain'
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

function QuickAddPopover({ track, anchor, onClose }: { track: Track; anchor: PopoverAnchor; onClose(): void }) {
  const items = useAppPlaylistsStore(state => state.items)
  const archiveError = useAppPlaylistsStore(state => state.error)
  const [lastId] = useState(readLastTarget)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const operation = useRef<AbortController | null>(null)
  useEffect(() => () => { operation.current?.abort() }, [])
  const close = useCallback(() => { operation.current?.abort(); onClose() }, [onClose])
  const ordered = orderQuickAddTargets(items, lastId)
  const filtered = ordered.filter(item => item.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))

  async function save(id?: string, label?: string) {
    if (operation.current || archiveError) return
    const controller = new AbortController()
    operation.current = controller
    setBusy(true)
    setError('')
    try {
      let resolved = track
      if (track.pending) {
        const tracks = await resolveAppPlaylistTracks([track], [], controller.signal)
        if (controller.signal.aborted) return
        if (!tracks.length) throw new Error('未能读取歌曲信息，请重试')
        resolved = tracks[0]
        // 平台漏回详情时保留可继续加载的占位，避免永久收藏空白曲名。
        if (!resolved.name.trim()) resolved = { ...resolved, name: '待加载歌曲', pending: true }
      }
      const store = useAppPlaylistsStore.getState()
      const added = id ? store.addTracks(id, [resolved]) : 1
      const targetId = id ?? store.create(name, [resolved])
      rememberTarget(targetId)
      const targetName = id ? label : name.trim()
      useToastStore.getState().show(added ? `已${id ? '加入' : '新建'}「${targetName}」，新增 ${added} 首` : `「${targetName}」已包含这首歌，新增 0 首`)
      onClose()
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : '保存失败，请重试')
    } finally {
      if (!controller.signal.aborted) { operation.current = null; setBusy(false) }
    }
  }
  function create(event: FormEvent) { event.preventDefault(); void save() }

  return <Floating anchor={anchor} label="加入应用歌单" onClose={close}>
    <div className={styles.header}>
      <strong>加入应用歌单</strong>
      <span title={`${track.name} · ${track.artist}`}>{track.name || '当前歌曲'}{track.artist && ` · ${track.artist}`}</span>
    </div>
    {archiveError ? <div className={styles.notice} role="alert">
      <p>{archiveError}</p><button type="button" onClick={() => useAppPlaylistsStore.getState().reload()}>重试读取</button>
    </div> : <>
      {(items.length > 5 || query) && <input className={styles.search} type="search" aria-label="搜索应用歌单" placeholder="搜索歌单" value={query} disabled={busy} onChange={event => setQuery(event.target.value)} />}
      {ordered.length > 0 && <div className={styles.list} role="group" aria-label="选择应用歌单">
        {filtered.map(item => {
          const included = containsTrack(item, track)
          return <button type="button" key={item.id} className={styles.target} disabled={busy || included} onClick={() => void save(item.id, item.name)}
            aria-label={included ? `${item.name}，已包含这首歌` : `加入 ${item.name}，${item.tracks.length} 首`}>
            <span className={styles.targetName} title={item.name}>{item.name}</span>
            <span className={styles.targetMeta}>{included ? '已在歌单' : `${item.tracks.length} 首`}</span>
            {included
              ? <svg className={styles.check} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg>
              : <span className={styles.addMark} aria-hidden="true"><PlusIcon /></span>}
          </button>
        })}
        {!filtered.length && <p className={styles.empty}>没有匹配的歌单</p>}
      </div>}
      {creating || !ordered.length
        ? <form className={styles.create} onSubmit={create}>
          <input autoFocus value={name} maxLength={80} placeholder="新歌单名称" aria-label="新歌单名称" disabled={busy} onChange={event => setName(event.target.value)} />
          <button type="submit" className={styles.primary} disabled={busy || !name.trim()}>新建并加入</button>
        </form>
        : <button type="button" className={styles.newButton} disabled={busy} onClick={() => setCreating(true)}><PlusIcon />新建歌单</button>}
    </>}
    {busy && <><p className={styles.empty} role="status">正在读取歌曲信息…</p><button type="button" className={styles.newButton} onClick={close}>取消操作</button></>}
    {error && <p className={styles.error} role="alert">{error}</p>}
  </Floating>
}

function TrackContextMenu({ track, anchor, onClose }: { track: Track; anchor: PopoverAnchor; onClose(): void }) {
  return <Floating anchor={anchor} label={`歌曲操作：${track.name}`} onClose={onClose}>
    <div className={styles.menu} role="menu">
      <button type="button" role="menuitem" onClick={() => useTrackActionsStore.getState().openQuickAdd(track, anchor)}>
        <PlusIcon />加入应用歌单…
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

/** 全局单曲操作层：右键菜单与快速加入弹层，挂在 App 根部，经 portal 逃离页面转场的 transform。 */
export function TrackActionLayer() {
  const quickAdd = useTrackActionsStore(state => state.quickAdd)
  const menu = useTrackActionsStore(state => state.menu)
  const close = useTrackActionsStore(state => state.close)
  if (!quickAdd && !menu) return null
  return createPortal(<>
    {menu && <TrackContextMenu key={`menu-${menu.anchor.x}-${menu.anchor.y}`} track={menu.track} anchor={menu.anchor} onClose={close} />}
    {quickAdd && <QuickAddPopover key={`add-${quickAdd.track.source}-${String(quickAdd.track.id)}-${quickAdd.anchor.x}-${quickAdd.anchor.y}`} track={quickAdd.track} anchor={quickAdd.anchor} onClose={close} />}
  </>, document.body)
}
