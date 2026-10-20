import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { appPlaylistTrackKey, useAppPlaylistsStore } from '../../stores/app-playlists'
import { useToastStore } from '../../stores/toast'
import { countIncludedTracks, orderQuickAddTargets, readLastTarget, rememberTarget } from '../../stores/track-actions'
import { appPlaylistSources } from '../../lib/app-playlist-presentation'
import { SOURCE_BRAND } from '../../lib/source-brand'
import { AppPlaylistSources } from './AppPlaylistSources'
import type { Track } from '../../types/domain'
import styles from './AppPlaylistDialog.module.css'
import { NameDialog, nameDialogStyles as nameStyles } from './NameDialog'

export function AppPlaylistModal({ title, onClose, children }: { title: string; onClose(): void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const dialog = ref.current
    dialog?.showModal()
    dialog?.querySelector<HTMLInputElement>('input:not(:disabled)')?.focus()
    return () => dialog?.close()
  }, [])
  return <dialog ref={ref} className={`${styles.dialog} no-drag`} aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); onClose() }} onKeyDown={event => event.stopPropagation()}>
    <div className={styles.header}><h2 id={titleId}>{title}</h2><button type="button" aria-label="关闭对话框" onClick={onClose}>×</button></div>
    {children}
  </dialog>
}

export function AppPlaylistNameDialog({ initialName = '', title, onSubmit, onClose }: { initialName?: string; title: string; onSubmit(name: string): void; onClose(): void }) {
  const [name, setName] = useState(initialName)
  const [error, setError] = useState('')
  return <NameDialog title={title} onClose={onClose}>
    <form onSubmit={event => {
      event.preventDefault()
      try { onSubmit(name); onClose() }
      catch (failure) { setError(failure instanceof Error ? failure.message : '保存失败，请重试') }
    }}>
      <div className={nameStyles.field} data-filled={name.length > 0}>
        <input autoFocus required maxLength={80} value={name} placeholder="歌单名称" aria-label="歌单名称" onChange={event => setName(event.target.value)} />
        <span className={nameStyles.count} data-full={name.length >= 80} aria-hidden="true">{name.length}/80</span>
      </div>
      {error && <p className={nameStyles.error} role="alert">{error}</p>}
      <div className={nameStyles.actions}>
        <button type="button" className={nameStyles.ghost} onClick={onClose}>取消</button>
        <button type="submit" className={nameStyles.primary} disabled={!name.trim()}>{initialName ? '保存' : '创建'}</button>
      </div>
    </form>
  </NameDialog>
}

export function AddToAppPlaylistDialog({ loadTracks, tracks, contextLabel, onClose, onDone }: { loadTracks(signal: AbortSignal): Promise<Track[]>; tracks?: Track[]; contextLabel?: string; onClose(): void; onDone?(): void }) {
  const items = useAppPlaylistsStore(state => state.items)
  const archiveError = useAppPlaylistsStore(state => state.error)
  const [lastId] = useState(readLastTarget)
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const operation = useRef<AbortController | null>(null)
  const knownCount = tracks === undefined ? undefined : new Set(tracks.map(appPlaylistTrackKey)).size
  const ordered = orderQuickAddTargets(items, lastId).filter(item => item.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  useEffect(() => () => { operation.current?.abort() }, [])

  function close() { operation.current?.abort(); onClose() }
  async function save(id?: string) {
    if (operation.current || archiveError) return
    const controller = new AbortController()
    operation.current = controller
    setBusy(true)
    setError('')
    try {
      const resolved = await loadTracks(controller.signal)
      if (controller.signal.aborted) return
      if (!resolved.length) throw new Error('没有可加入的歌曲')
      const store = useAppPlaylistsStore.getState()
      const targetName = id ? store.items.find(item => item.id === id)?.name : name.trim()
      const added = id ? store.addTracks(id, resolved) : new Set(resolved.map(appPlaylistTrackKey)).size
      const targetId = id ?? store.create(name, resolved)
      rememberTarget(targetId)
      useToastStore.getState().show(added ? `已${id ? '加入' : '新建'}「${targetName}」，新增 ${added} 首` : `「${targetName}」已包含所选歌曲，新增 0 首`)
      onDone?.()
      onClose()
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : '保存失败，请重试')
    } finally {
      if (!controller.signal.aborted) { operation.current = null; setBusy(false) }
    }
  }

  return <AppPlaylistModal title="加入应用歌单" onClose={close}>
    {(contextLabel || knownCount !== undefined) && <p className={styles.context}>{contextLabel}{knownCount !== undefined && <span>{contextLabel ? ' · ' : ''}{knownCount} 首歌曲</span>}</p>}
    {archiveError ? <div role="alert"><p className={styles.error}>{archiveError}</p><button onClick={() => useAppPlaylistsStore.getState().reload()}>重试读取</button></div>
      : <>
        {(items.length > 5 || query) && <input className={styles.search} type="search" aria-label="搜索应用歌单" placeholder="搜索歌单" value={query} disabled={busy} onChange={event => setQuery(event.target.value)} />}
        <div className={styles.list} aria-label="选择应用歌单">
          {ordered.map(item => {
            const included = tracks === undefined ? 0 : countIncludedTracks(item, tracks)
            const allIncluded = knownCount !== undefined && knownCount > 0 && included === knownCount
            const status = allIncluded ? '已包含全部歌曲' : included ? `已包含 ${included} 首` : ''
            return <button key={item.id} type="button" disabled={busy || allIncluded} onClick={() => void save(item.id)} aria-label={`加入 ${item.name}，${item.tracks.length} 首${status ? `，${status}` : ''}${item.tracks.length ? `，${appPlaylistSources(item.tracks).map(({ source, count }) => `${SOURCE_BRAND[source].label} ${count} 首`).join('、')}` : ''}`}>
              <span className={styles.targetInfo}><strong title={item.name}>{item.name}</strong><span><small>{item.tracks.length} 首</small><AppPlaylistSources tracks={item.tracks} compact />{status && <small className={styles.included}>{status}</small>}</span></span><span aria-hidden="true">{allIncluded ? '✓' : '＋'}</span>
            </button>
          })}
          {!ordered.length && <p className={styles.hint}>{items.length ? '没有匹配的歌单' : '还没有应用歌单，新建一份开始收藏。'}</p>}
        </div>
        {!items.length && <p className={styles.hint}>不同平台的歌曲可以收进同一份歌单，仅保存在应用内。</p>}
        {creating || !items.length ? <form className={`${styles.form} ${styles.create}`} onSubmit={event => { event.preventDefault(); void save() }}>
          <label>新建歌单<input autoFocus required maxLength={80} value={name} disabled={busy} placeholder="歌单名称" onChange={event => setName(event.target.value)} /></label>
          <div className={styles.actions}><button type="button" onClick={close}>{busy ? '取消操作' : '取消'}</button><button className={styles.primary} type="submit" disabled={busy || !name.trim()}>新建并加入</button></div>
        </form> : <div className={styles.actions}><button type="button" disabled={busy} onClick={() => setCreating(true)}>新建歌单</button><button type="button" onClick={close}>{busy ? '取消操作' : '取消'}</button></div>}
      </>}
    {busy && <p className={styles.hint} role="status">正在整理歌曲…</p>}
    {error && <p className={styles.error} role="alert">{error}</p>}
  </AppPlaylistModal>
}
