import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useAppPlaylistsStore } from '../../stores/app-playlists'
import { useToastStore } from '../../stores/toast'
import type { Track } from '../../types/domain'
import styles from './AppPlaylistDialog.module.css'

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
  return <AppPlaylistModal title={title} onClose={onClose}>
    <form className={styles.form} onSubmit={event => {
      event.preventDefault()
      try { onSubmit(name); onClose() }
      catch (failure) { setError(failure instanceof Error ? failure.message : '保存失败，请重试') }
    }}>
      <label>歌单名称<input autoFocus required maxLength={80} value={name} placeholder="给歌单起个名字" onChange={event => setName(event.target.value)} /></label>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.actions}><button type="button" onClick={onClose}>取消</button><button className={styles.primary} type="submit" disabled={!name.trim()}>保存</button></div>
    </form>
  </AppPlaylistModal>
}

export function AddToAppPlaylistDialog({ loadTracks, onClose, onDone }: { loadTracks(signal: AbortSignal): Promise<Track[]>; onClose(): void; onDone?(): void }) {
  const items = useAppPlaylistsStore(state => state.items)
  const archiveError = useAppPlaylistsStore(state => state.error)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const operation = useRef<AbortController | null>(null)
  useEffect(() => () => { operation.current?.abort() }, [])

  function close() { operation.current?.abort(); onClose() }
  async function save(id?: string) {
    if (operation.current || archiveError) return
    const controller = new AbortController()
    operation.current = controller
    setBusy(true)
    setError('')
    try {
      const tracks = await loadTracks(controller.signal)
      if (controller.signal.aborted) return
      if (!tracks.length) throw new Error('没有可加入的歌曲')
      const store = useAppPlaylistsStore.getState()
      const added = id ? store.addTracks(id, tracks) : (store.create(name, tracks), tracks.length)
      useToastStore.getState().show(added ? `已加入应用歌单，共 ${added} 首` : '应用歌单已包含所选歌曲')
      onDone?.()
      onClose()
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : '保存失败，请重试')
    } finally {
      if (!controller.signal.aborted) { operation.current = null; setBusy(false) }
    }
  }

  return <AppPlaylistModal title="加入应用歌单" onClose={close}>
    <p className={styles.hint}>在 Simple Music 中整理来自不同平台和本地的歌曲。</p>
    {archiveError ? <div role="alert"><p className={styles.error}>{archiveError}</p><button onClick={() => useAppPlaylistsStore.getState().reload()}>重试读取</button></div>
      : <>
        <div className={styles.list} aria-label="选择应用歌单">
          {items.length ? items.map(item => <button key={item.id} type="button" disabled={busy} onClick={() => void save(item.id)} aria-label={`加入 ${item.name}`}>
            <span>{item.name}</span><small>{item.tracks.length} 首</small><span aria-hidden="true">＋</span>
          </button>) : <p className={styles.hint}>还没有应用歌单，在下面新建一个。</p>}
        </div>
        <form className={styles.form} onSubmit={event => { event.preventDefault(); void save() }}>
          <label>新建歌单<input autoFocus={!items.length} required maxLength={80} value={name} disabled={busy} placeholder="歌单名称" onChange={event => setName(event.target.value)} /></label>
          <div className={styles.actions}><button type="button" onClick={close}>{busy ? '取消操作' : '取消'}</button><button className={styles.primary} type="submit" disabled={busy || !name.trim()}>新建并加入</button></div>
        </form>
      </>}
    {busy && <p className={styles.hint} role="status">正在整理歌曲…</p>}
    {error && <p className={styles.error} role="alert">{error}</p>}
  </AppPlaylistModal>
}
