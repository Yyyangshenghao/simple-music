import { useEffect, useRef, useState } from 'react'
import { providerFor } from '../../providers/registry'
import { useProviderStore } from '../../stores/providers'
import { providerAccountSession } from '../../lib/provider-account-session'
import { inspectPlatformPlaylist, mutatePlatformPlaylist, platformPlaylistResultMessage } from '../../lib/platform-playlists'
import { useToastStore } from '../../stores/toast'
import { AppPlaylistModal } from './AppPlaylistDialog'
import type { Playlist, Track } from '../../types/domain'
import type { WritablePlaylistSource } from '../../types/platform-playlist'
import styles from './PlatformPlaylistDialog.module.css'

const platformName = (source: WritablePlaylistSource) => source === 'qq' ? 'QQ 音乐' : '网易云音乐'
const failureMessage = (failure: unknown) => failure instanceof Error ? failure.message : '平台操作失败，请刷新歌单后重试'

function usePlatformOperation(source: WritablePlaylistSource) {
  const signature = useProviderStore(state => `${source}:${state.byId[source].enabled}:${state.byId[source].auth}:${providerAccountSession(source)}`)
  const initial = useRef(signature)
  const operation = useRef<AbortController | null>(null)
  const account = useRef(providerAccountSession(source))
  const [busy, setBusy] = useState(false)
  const valid = initial.current === signature
  const current = (signal: AbortSignal) => !signal.aborted && initial.current === signature && account.current === providerAccountSession(source)
  useEffect(() => () => { operation.current?.abort() }, [signature])
  function begin() {
    if (operation.current || !valid || account.current !== providerAccountSession(source)) return null
    const controller = new AbortController()
    operation.current = controller
    setBusy(true)
    return controller
  }
  function finish(controller: AbortController) {
    if (current(controller.signal) && operation.current === controller) { operation.current = null; setBusy(false) }
  }
  return { operation, busy, valid, current, begin, finish }
}

function Scope({ source, creating = false }: { source: WritablePlaylistSource; creating?: boolean }) {
  return <p className={styles.hint}>{creating ? `将在${platformName(source)}新建仅自己可见的歌单。` : `直接保存到${platformName(source)}，仅接受该平台歌曲。`}{source === 'qq' && 'QQ 音乐目前仅支持管理私密歌单。'}</p>
}

export function PlatformPlaylistNameDialog({ source, playlist, onClose, onCreated }: {
  source: WritablePlaylistSource
  playlist?: Playlist
  onClose(): void
  onCreated?(playlistId: string, name: string): void
}) {
  const [name, setName] = useState(playlist?.name ?? '')
  const [error, setError] = useState('')
  const [uncertain, setUncertain] = useState(false)
  const requestId = useRef('')
  if (!requestId.current) requestId.current = crypto.randomUUID()
  const task = usePlatformOperation(source)
  const maxLength = source === 'qq' ? 20 : 80
  function close() { task.operation.current?.abort(); onClose() }
  async function save() {
    const trimmed = name.trim()
    if (!trimmed || trimmed.length > maxLength || uncertain) return
    const controller = task.begin()
    if (!controller) return
    setError('')
    try {
      if (playlist) {
        if (playlist.source !== source) throw new Error('歌单与当前平台不一致，请重新打开')
        await inspectPlatformPlaylist(source, String(playlist.id), controller.signal)
        if (!task.current(controller.signal)) return
      }
      const result = await mutatePlatformPlaylist(source, playlist
        ? { action: 'rename', playlistId: String(playlist.id), name: trimmed }
        : { action: 'create', name: trimmed, requestId: requestId.current }, controller.signal)
      if (!task.current(controller.signal)) return
      if (result.status !== 'complete') {
        setError(`${platformPlaylistResultMessage(result, playlist ? 'rename' : 'create')}。请刷新平台歌单查看结果。`)
        if (!playlist) setUncertain(true)
        return
      }
      useToastStore.getState().show(platformPlaylistResultMessage(result, playlist ? 'rename' : 'create'))
      onCreated?.(result.playlistId, trimmed)
      onClose()
    } catch (failure) {
      if (task.current(controller.signal)) setError(failureMessage(failure))
    } finally { task.finish(controller) }
  }
  return <AppPlaylistModal title={`${playlist ? '重命名' : '新建'}${platformName(source)}歌单`} onClose={close}>
    <Scope source={source} creating={!playlist} />
    <form className={styles.form} onSubmit={event => { event.preventDefault(); void save() }}>
      <label>歌单名称<input autoFocus required maxLength={maxLength} value={name} disabled={task.busy || !task.valid || uncertain}
        placeholder="给歌单起个名字" onChange={event => setName(event.target.value)} /></label>
      <small className={styles.limit}>最多 {maxLength} 个字符</small>
      {!task.valid && <p className={styles.error} role="alert">账号或平台状态已变化，请关闭后重新操作。</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      {task.busy && <p className={styles.hint} role="status">正在{playlist ? '保存名称' : '新建歌单'}…取消不会撤回已发送的平台操作。</p>}
      <div className={styles.actions}><button type="button" onClick={close}>{task.busy ? '取消操作' : uncertain ? '关闭并查看歌单' : '取消'}</button>
        {!uncertain && <button className={styles.primary} type="submit" disabled={task.busy || !task.valid || !name.trim()}>{playlist ? '保存名称' : '新建私密歌单'}</button>}
      </div>
    </form>
  </AppPlaylistModal>
}

export function AddToPlatformPlaylistDialog({ source, loadTracks, onClose, onDone }: {
  source: WritablePlaylistSource
  loadTracks(signal: AbortSignal): Promise<Track[]>
  onClose(): void
  onDone?(): void
}) {
  const [items, setItems] = useState<Array<{ id: string; name: string }>>([])
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState('')
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState<{ id: string; name: string } | null>(null)
  const createdTarget = useRef<{ id: string; name: string } | null>(null)
  const [reload, setReload] = useState(0)
  const task = usePlatformOperation(source)
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setListError('')
    setItems([])
    async function load() {
      try {
        const library = providerFor(source).library
        if (!library?.getUserPlaylists) throw new Error('当前平台无法读取歌单，请稍后重试')
        const playlists = await library.getUserPlaylists()
        if (!task.current(controller.signal)) return
        const targets: Array<{ id: string; name: string }> = []
        let unverified = false
        // 清单并非权限凭据；只展示服务端确认可编辑的目标，并限制同时核验数。
        const candidates = [...new Map(playlists.filter(item => item.source === source).map(item => [String(item.id), item])).values()]
        const order = new Map(candidates.map((item, index) => [String(item.id), index]))
        for (let offset = 0; offset < candidates.length; offset += 3) {
          if (!task.current(controller.signal)) return
          await Promise.all(candidates.slice(offset, offset + 3).map(async item => {
            try {
              const target = await inspectPlatformPlaylist(source, String(item.id), controller.signal)
              targets.push({ id: target.playlistId, name: target.name })
            } catch { unverified = true }
          }))
          if (!task.current(controller.signal)) return
          const sorted = [...targets].sort((a, b) => order.get(a.id)! - order.get(b.id)!)
          const recent = createdTarget.current
          setItems(recent ? [recent, ...sorted.filter(item => item.id !== recent.id)] : sorted)
        }
        if (!task.current(controller.signal)) return
        if (unverified) setListError('部分歌单不可编辑或暂时无法核验，已隐藏。可刷新歌单重试。')
      } catch (failure) {
        if (task.current(controller.signal)) setListError(failureMessage(failure))
      } finally { if (task.current(controller.signal)) setLoading(false) }
    }
    if (task.valid) void load()
    return () => controller.abort()
  }, [source, reload, task.valid])

  function close() { task.operation.current?.abort(); onClose() }
  async function save(target: { id: string; name: string }) {
    const controller = task.begin()
    if (!controller) return
    setError('')
    try {
      const tracks = await loadTracks(controller.signal)
      if (!task.current(controller.signal)) return
      if (!tracks.length) throw new Error('没有可加入的歌曲')
      if (tracks.some(track => track.source !== source)) throw new Error(`只能加入${platformName(source)}的歌曲，请按平台分别选择；不会自动匹配其他版本。`)
      await inspectPlatformPlaylist(source, target.id, controller.signal)
      if (!task.current(controller.signal)) return
      const result = await mutatePlatformPlaylist(source, { action: 'add', playlistId: target.id, tracks: [...new Map(tracks.map(track => [String(track.id), {
        source: track.source, id: String(track.id), qqId: track.qqId === undefined ? undefined : String(track.qqId),
        songType: typeof track.songType === 'number' ? track.songType : undefined,
      }])).values()] }, controller.signal)
      if (!task.current(controller.signal)) return
      if (result.status !== 'complete') {
        setError(`「${target.name}」：${platformPlaylistResultMessage(result, 'add')}。请先刷新歌单核对结果。`)
        return
      }
      useToastStore.getState().show(platformPlaylistResultMessage(result, 'add'))
      onDone?.()
      onClose()
    } catch (failure) {
      if (task.current(controller.signal)) setError(`「${target.name}」：${failureMessage(failure)}`)
    } finally { task.finish(controller) }
  }

  if (creating && task.valid) return <PlatformPlaylistNameDialog source={source} onClose={() => setCreating(false)} onCreated={(id, name) => {
    const target = { id, name }
    createdTarget.current = target
    setCreated(target)
    setItems(previous => [target, ...previous.filter(item => item.id !== id)])
    void save(target)
  }} />

  return <AppPlaylistModal title={`加入${platformName(source)}歌单`} onClose={close}>
    <Scope source={source} />
    {!task.valid ? <p className={styles.error} role="alert">账号或平台状态已变化，请关闭后重新操作。</p> : <>
      {loading && <p className={styles.hint} role="status">正在读取可编辑歌单…</p>}
      {listError && <div className={styles.notice}><p className={styles.error} role="alert">{listError}</p><button type="button" disabled={task.busy || loading} onClick={() => setReload(value => value + 1)}>刷新歌单</button></div>}
      {created && <p className={styles.hint}>已新建「{created.name}」。{error ? '歌曲尚未确认加入，歌单会保留。' : '正在加入歌曲…'}</p>}
      <div className={styles.list} aria-label="选择平台歌单">{items.map(item => <button key={item.id} type="button" disabled={task.busy} title={item.name} onClick={() => void save(item)} aria-label={`加入 ${item.name}`}>
        <span>{item.name}</span><span aria-hidden="true">＋</span>
      </button>)}</div>
      {!loading && !items.length && <p className={styles.hint}>没有可编辑的{source === 'qq' ? '私密' : '自建'}歌单，可以新建一个。</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      {error && !listError && <button type="button" disabled={task.busy || loading} onClick={() => setReload(value => value + 1)}>刷新歌单</button>}
      {task.busy && <p className={styles.hint} role="status">正在加入歌曲…取消不会撤回已发送的平台操作。</p>}
    </>}
    <div className={styles.actions}><button type="button" onClick={close}>{task.busy ? '取消操作' : '取消'}</button>
      <button type="button" className={styles.primary} disabled={task.busy || !task.valid} onClick={() => setCreating(true)}>新建并加入</button>
    </div>
  </AppPlaylistModal>
}
