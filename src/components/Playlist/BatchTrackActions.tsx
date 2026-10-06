import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { PROVIDER_IDS } from '../../providers/types'
import { useProviderStore } from '../../stores/providers'
import { providerAccountSession } from '../../lib/provider-account-session'
import { resolveBatchTracks } from '../../lib/batch-tracks'
import { usePlaylistStore } from '../../stores/playlist'
import { useOfflineCacheStore } from '../../stores/offline-cache'
import { useToastStore } from '../../stores/toast'
import type { Playlist, Track } from '../../types/domain'
import styles from './BatchTrackActions.module.css'

interface Props {
  tracks: Track[]
  collections?: Playlist[]
  label?: string
  compact?: boolean
  menuLabel?: string
  onSelect?(): void
  selection?: { total: number; onSelectAll(): void; onClear(): void; onExit(): void }
  onDone?(): void
}

export function BatchTrackActions({ tracks, collections = [], label, compact = false, menuLabel = '更多操作', onSelect, selection, onDone }: Props) {
  const [open, setOpen] = useState(false)
  const menuId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const operation = useRef<AbortController | null>(null)
  const accountSignature = useProviderStore((state) => PROVIDER_IDS.map((source) => `${state.byId[source].enabled}:${state.byId[source].auth}:${providerAccountSession(source)}`).join('|'))
  const signature = [...tracks, ...collections].map((item) => `${item.source}:${item.type}:${String(item.id)}`).join('|')
  const sourceSet = new Set([...tracks, ...collections].map((item) => item.source))
  const canSave = sourceSet.size === 0 || [...sourceSet].every((item) => item === 'netease' || item === 'qq')
  const count = tracks.length + collections.length

  useEffect(() => {
    operation.current?.abort()
    setBusy(false)
    setOpen(false)
    setError('')
    return () => { operation.current?.abort() }
  }, [signature, accountSignature])

  async function run(action: (signal: AbortSignal) => Promise<void>) {
    if (busy || !count) return
    operation.current?.abort()
    const controller = new AbortController()
    operation.current = controller
    setBusy(true)
    setError('')
    if (compact) closeMenu()
    try {
      await action(controller.signal)
    } catch (failure) {
      if (!controller.signal.aborted && !(failure instanceof Error && failure.name === 'AbortError')) {
        const message = failure instanceof Error ? failure.message : '操作失败，请重试'
        if (compact) useToastStore.getState().show(message)
        else setError(message)
      }
    } finally {
      if (!controller.signal.aborted) setBusy(false)
    }
  }

  function closeMenu() {
    setOpen(false)
    triggerRef.current?.focus()
  }

  useEffect(() => {
    if (!open) return
    panelRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    const onPointerDown = (event: globalThis.PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onFocus = (event: FocusEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeMenu() }
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('focusin', onFocus)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('focusin', onFocus)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    event.stopPropagation()
    const items = Array.from(panelRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
    if (!items.length) return
    const current = items.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
      : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    items[next].focus()
  }

  const commands = <>
    <button type="button" className={compact ? undefined : styles.primary} role={compact ? 'menuitem' : undefined} disabled={busy || !count} onClick={() => void run(async (signal) => {
      const resolved = await resolveBatchTracks(tracks, collections, signal)
      if (signal.aborted) return
      const added = usePlaylistStore.getState().addManyToQueue(resolved)
      useToastStore.getState().show(added ? `已追加 ${added} 首到播放队列` : '播放队列已包含所选歌曲')
      onDone?.()
    })}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M4 6h16M4 11h10M4 16h7m7-3v8m-4-4h8" strokeLinecap="round" /></svg>添加到播放队列</button>
    {canSave && <button type="button" role={compact ? 'menuitem' : undefined} disabled={busy || !count} onClick={() => void run(async (signal) => {
      const resolved = await resolveBatchTracks(tracks, collections, signal)
      if (signal.aborted) return
      const added = await useOfflineCacheStore.getState().saveMany(resolved, signal)
      if (signal.aborted) return
      useToastStore.getState().show(added ? `${added} 首已加入下载队列` : '所选歌曲已在下载队列中')
      onDone?.()
    })}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M5 18v3h14v-3" strokeLinecap="round" strokeLinejoin="round" /></svg>批量下载</button>}
    {busy && <><span className={styles.processing} role="status">处理中…</span><button type="button" role={compact ? 'menuitem' : undefined} onClick={() => { operation.current?.abort(); setBusy(false); if (compact) closeMenu() }}>取消操作</button></>}
  </>

  if (compact) return (
    <div className={styles.compact} ref={rootRef}>
      <button ref={triggerRef} type="button" className={styles.more} aria-label={menuLabel} title={busy ? '处理中，可打开菜单取消' : menuLabel}
        aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined} aria-busy={busy} disabled={!count}
        onClick={() => setOpen(value => !value)} onKeyDown={event => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); event.stopPropagation(); setOpen(true) }
        }}>
        {busy ? <span className={styles.spinner} aria-hidden="true" /> : <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg>}
      </button>
      {open && <div className={styles.menu} ref={panelRef} id={menuId} role="menu" aria-label={menuLabel} onKeyDown={onMenuKeyDown}>
        {label && <span className={styles.menuHeading}>{label}</span>}
        {commands}
        {onSelect && <button type="button" role="menuitem" disabled={busy || !count} className={styles.selectItem} onClick={() => { closeMenu(); onSelect() }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5" /><path d="m7 12 3 3 7-7" strokeLinecap="round" strokeLinejoin="round" /></svg>多选歌曲
        </button>}
      </div>}
    </div>
  )

  return (
    <div className={styles.actions} data-selecting={!!selection} role="region" aria-label={selection ? '多选操作' : '集合操作'}>
      <div className={styles.bar}>
        <div className={styles.identity}>
          {selection ? <><strong className={styles.count}>{count}</strong><div><span className={styles.label}>已选项目</span><span className={styles.hint} title="⌘/Ctrl+A 全选 · Esc 退出 · ⌘/Ctrl 框选反选">共 {selection.total} 项 · 拖动框选 / Shift 连选</span></div></> : <span className={styles.label}>{label ?? `${count} 项已选`}</span>}
        </div>
        {selection && <div className={styles.selectionTools}>
          <button type="button" disabled={busy || !selection.total} onClick={selection.onSelectAll}>全选</button>
          <button type="button" disabled={busy || !count} onClick={selection.onClear}>清空</button>
        </div>}
        <div className={styles.commands}>
          {commands}
        </div>
        {selection && <button type="button" className={styles.exit} aria-label="退出多选" title="退出多选（Esc）" onClick={selection.onExit}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" strokeLinecap="round" /></svg></button>}
      </div>
      {error && <p className={styles.error} role="alert">{error}</p>}
    </div>
  )
}
