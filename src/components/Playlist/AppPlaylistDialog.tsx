import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { appPlaylistTrackKey, useAppPlaylistsStore } from '../../stores/app-playlists'
import { useToastStore } from '../../stores/toast'
import { countIncludedTracks, orderQuickAddTargets, readLastTarget, rememberTarget } from '../../stores/track-actions'
import { appPlaylistSources } from '../../lib/app-playlist-presentation'
import { SOURCE_BRAND } from '../../lib/source-brand'
import { AppPlaylistSources } from './AppPlaylistSources'
import type { Track } from '../../types/domain'
import styles from './AppPlaylistDialog.module.css'
import { CHECK_ICON, NameDialog, PLUS_ICON, SEARCH_ICON, nameDialogStyles as nameStyles } from './NameDialog'
import { AppPlaylistCover } from './AppPlaylistCover'
import { CloseIcon } from '../ui/CloseIcon'

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
    <div className={styles.header}><h2 id={titleId}>{title}</h2><button type="button" aria-label="关闭对话框" onClick={onClose}><CloseIcon size={14} /></button></div>
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

export interface AddTracksProps { loadTracks(signal: AbortSignal): Promise<Track[]>; tracks?: Track[]; onClose(): void; onDone?(): void }

export function playlistContextSubtitle(contextLabel: string | undefined, tracks: Track[] | undefined): ReactNode {
  const knownCount = tracks === undefined ? undefined : new Set(tracks.map(appPlaylistTrackKey)).size
  if (!contextLabel && knownCount === undefined) return undefined
  return <>{contextLabel}{knownCount !== undefined && <span>{contextLabel ? ' · ' : ''}{knownCount} 首歌曲</span>}</>
}

/** 应用歌单选择主体，嵌在统一的「加入歌单」弹窗里。 */
export function AppPlaylistPicker({ loadTracks, tracks, onClose, onDone }: AddTracksProps) {
  const items = useAppPlaylistsStore(state => state.items)
  const archiveError = useAppPlaylistsStore(state => state.error)
  const [lastId] = useState(readLastTarget)
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [busyTarget, setBusyTarget] = useState<string | null>(null)
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
      if (!controller.signal.aborted) { operation.current = null; setBusy(false); setBusyTarget(null) }
    }
  }

  return <>
    {archiveError ? <div className={nameStyles.notice} role="alert"><span>{archiveError}</span><button type="button" onClick={() => useAppPlaylistsStore.getState().reload()}>重试读取</button></div>
      : creating || !items.length ? <form onSubmit={event => { event.preventDefault(); void save() }}>
        <div className={nameStyles.field} data-filled={name.length > 0}>
          <input autoFocus required maxLength={80} value={name} disabled={busy} placeholder="新歌单名称" aria-label="新歌单名称" onChange={event => setName(event.target.value)} />
          <span className={nameStyles.count} data-full={name.length >= 80} aria-hidden="true">{name.length}/80</span>
        </div>
        {!items.length && <p className={nameStyles.note}>不同平台的歌曲可以放进同一份歌单</p>}
        {error && <p className={nameStyles.error} role="alert">{error}</p>}
        <div className={nameStyles.actions}>
          <button type="button" className={nameStyles.ghost} onClick={() => items.length ? setCreating(false) : close()}>{items.length ? '返回' : '取消'}</button>
          <button type="submit" className={nameStyles.primary} disabled={busy || !name.trim()}>{busy ? <><span className={nameStyles.spinner} aria-hidden="true" />加入中</> : '创建并加入'}</button>
        </div>
      </form>
      : <>
        {(items.length > 5 || query) && <label className={nameStyles.search}>{SEARCH_ICON}<input type="search" aria-label="搜索应用歌单" placeholder="搜索歌单" value={query} disabled={busy} onChange={event => setQuery(event.target.value)} /></label>}
        <div className={nameStyles.list} aria-label="选择应用歌单">
          {!query && <button type="button" className={nameStyles.row} disabled={busy} onClick={() => setCreating(true)}>
            <span className={`${nameStyles.thumb} ${nameStyles.newThumb}`} aria-hidden="true">{PLUS_ICON}</span>
            <span className={nameStyles.rowText}><strong>新建歌单</strong></span>
          </button>}
          {ordered.map(item => {
            const included = tracks === undefined ? 0 : countIncludedTracks(item, tracks)
            const allIncluded = knownCount !== undefined && knownCount > 0 && included === knownCount
            const status = allIncluded ? '已包含全部歌曲' : included ? `已包含 ${included} 首` : ''
            const saving = busyTarget === item.id
            return <button key={item.id} type="button" className={nameStyles.row} data-state={saving ? 'busy' : allIncluded ? 'done' : undefined}
              disabled={busy || allIncluded} onClick={() => { setBusyTarget(item.id); void save(item.id) }}
              aria-label={`加入 ${item.name}，${item.tracks.length} 首${status ? `，${status}` : ''}${item.tracks.length ? `，${appPlaylistSources(item.tracks).map(({ source, count }) => `${SOURCE_BRAND[source].label} ${count} 首`).join('、')}` : ''}`}>
              <span className={nameStyles.thumb} aria-hidden="true"><AppPlaylistCover tracks={item.tracks} /></span>
              <span className={nameStyles.rowText}>
                <strong title={item.name}>{item.name}</strong>
                <small>{status ? <span className={nameStyles.included}>{status}</span> : `${item.tracks.length} 首`}<AppPlaylistSources tracks={item.tracks} compact /></small>
              </span>
              <span className={nameStyles.rowAction} aria-hidden="true">{saving ? <span className={nameStyles.spinner} /> : allIncluded ? CHECK_ICON : PLUS_ICON}</span>
            </button>
          })}
          {!ordered.length && <p className={nameStyles.empty}>没有匹配的歌单</p>}
        </div>
        {error && <p className={nameStyles.error} role="alert">{error}</p>}
        <div className={nameStyles.actions}><button type="button" className={nameStyles.ghost} onClick={close}>取消</button></div>
      </>}
  </>
}
