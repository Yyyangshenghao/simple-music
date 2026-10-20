import { useEffect, useRef, useState } from 'react'
import { providerFor } from '../../providers/registry'
import { useProviderStore } from '../../stores/providers'
import { providerAccountSession } from '../../lib/provider-account-session'
import { inspectPlatformPlaylist, mutatePlatformPlaylist, platformPlaylistResultMessage } from '../../lib/platform-playlists'
import { useToastStore } from '../../stores/toast'
import { LOCK_ICON, NameDialog, PLUS_ICON, nameDialogStyles as nameStyles } from './NameDialog'
import { PlaylistCoverFallback } from '../ui/PlaylistCoverFallback'
import { sizedImage } from '../../lib/image-size'
import { SourceBadge } from '../ui/SourceBadge'
import { LockGlyph } from '../ui/LockGlyph'
import type { Playlist, Track } from '../../types/domain'
import type { WritablePlaylistSource } from '../../types/platform-playlist'

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

export function PlatformPlaylistNameDialog({ source, playlist, onClose, onCreated }: {
  source: WritablePlaylistSource
  playlist?: Playlist
  onClose(): void
  onCreated?(playlistId: string, name: string): void
}) {
  const [name, setName] = useState(playlist?.name ?? '')
  const [error, setError] = useState('')
  const [uncertain, setUncertain] = useState(false)
  const [isPublic, setIsPublic] = useState(false)
  // 公开创建只开放网易云；QQ 公开歌单的归属核对未验证。
  const canPublish = !playlist && source === 'netease'
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
        : { action: 'create', name: trimmed, requestId: requestId.current, ...(canPublish && isPublic ? { public: true } : {}) }, controller.signal)
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
  return <NameDialog title={playlist ? '重命名歌单' : '新建歌单'} badge={<SourceBadge source={source} displayMode="always" showInactive />} onClose={close}>
    <form onSubmit={event => { event.preventDefault(); void save() }}>
      <div className={nameStyles.field} data-filled={name.length > 0}>
        <input autoFocus required maxLength={maxLength} value={name} disabled={task.busy || !task.valid || uncertain}
          placeholder="歌单名称" aria-label="歌单名称" onChange={event => setName(event.target.value)} />
        <span className={nameStyles.count} data-full={name.length >= maxLength} aria-hidden="true">{name.length}/{maxLength}</span>
      </div>
      {canPublish ? <div className={nameStyles.privacy}>
        <span>{isPublic ? '公开歌单' : '私有歌单'}</span>
        <button type="button" className={nameStyles.lock} aria-pressed={isPublic} aria-label={isPublic ? '改为私有歌单' : '改为公开歌单'}
          disabled={task.busy || !task.valid || uncertain} onClick={() => setIsPublic(value => !value)}>
          <LockGlyph open={isPublic} />
        </button>
      </div> : !playlist && <p className={nameStyles.note}>{LOCK_ICON}仅自己可见</p>}
      {!task.valid && <p className={nameStyles.error} role="alert">账号或平台状态已变化，请关闭后重新操作。</p>}
      {error && <p className={nameStyles.error} role="alert">{error}</p>}
      <div className={nameStyles.actions}>
        <button type="button" className={nameStyles.ghost} onClick={close} title={task.busy ? '已发送的平台操作不会被撤回' : undefined}>{uncertain ? '关闭并查看歌单' : '取消'}</button>
        {!uncertain && <button type="submit" className={nameStyles.primary} disabled={task.busy || !task.valid || !name.trim()}>
          {task.busy ? <><span className={nameStyles.spinner} aria-hidden="true" />{playlist ? '保存中' : '创建中'}</> : playlist ? '保存' : '创建'}
        </button>}
      </div>
    </form>
  </NameDialog>
}

type Target = { id: string; name: string; cover?: string; trackCount?: number }

interface AddProps {
  source: WritablePlaylistSource
  loadTracks(signal: AbortSignal): Promise<Track[]>
  onClose(): void
  onDone?(): void
}

/** 平台歌单选择主体，嵌在统一的「加入歌单」弹窗里。 */
export function PlatformPlaylistPicker({ source, loadTracks, onClose, onDone }: AddProps) {
  const [items, setItems] = useState<Target[]>([])
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState('')
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState<{ id: string; name: string } | null>(null)
  const createdTarget = useRef<{ id: string; name: string } | null>(null)
  const [reload, setReload] = useState(0)
  const task = usePlatformOperation(source)
  const [busyTarget, setBusyTarget] = useState<string | null>(null)
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
        const targets: Target[] = []
        let unverified = false
        // 清单并非权限凭据；只展示服务端确认可编辑的目标，并限制同时核验数。
        const candidates = [...new Map(playlists.filter(item => item.source === source).map(item => [String(item.id), item])).values()]
        const order = new Map(candidates.map((item, index) => [String(item.id), index]))
        for (let offset = 0; offset < candidates.length; offset += 3) {
          if (!task.current(controller.signal)) return
          await Promise.all(candidates.slice(offset, offset + 3).map(async item => {
            try {
              const target = await inspectPlatformPlaylist(source, String(item.id), controller.signal)
              targets.push({ id: target.playlistId, name: target.name, cover: item.cover, trackCount: item.trackCountKnown === false ? undefined : item.trackCount })
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
  async function save(target: Target) {
    const controller = task.begin()
    if (!controller) return
    setError('')
    setBusyTarget(target.id)
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
    } finally { task.finish(controller); if (task.current(controller.signal)) setBusyTarget(null) }
  }

  return <>
    {/* 新建叠在选择器之上，取消后回到列表。 */}
    {creating && task.valid && <PlatformPlaylistNameDialog source={source} onClose={() => setCreating(false)} onCreated={(id, name) => {
      const target = { id, name }
      createdTarget.current = target
      setCreated(target)
      setItems(previous => [target, ...previous.filter(item => item.id !== id)])
      void save(target)
    }} />}
    {!task.valid ? <p className={nameStyles.error} role="alert">账号或平台状态已变化，请关闭后重新操作。</p> : <>
      <div className={nameStyles.list} aria-label="选择平台歌单">
        <button type="button" className={nameStyles.row} disabled={task.busy} onClick={() => setCreating(true)} aria-label="新建并加入">
          <span className={`${nameStyles.thumb} ${nameStyles.newThumb}`} aria-hidden="true">{PLUS_ICON}</span>
          <span className={nameStyles.rowText}><strong>新建歌单</strong></span>
        </button>
        {items.map(item => <button key={item.id} type="button" className={nameStyles.row} data-state={busyTarget === item.id ? 'busy' : undefined}
          disabled={task.busy} title={item.name} onClick={() => void save(item)} aria-label={`加入 ${item.name}`}>
          <span className={nameStyles.thumb} aria-hidden="true">{item.cover ? <img src={sizedImage(item.cover, 96)} alt="" loading="lazy" /> : <PlaylistCoverFallback name={item.name} source={source} />}</span>
          <span className={nameStyles.rowText}><strong>{item.name}</strong>{item.trackCount !== undefined && <small>{item.trackCount} 首</small>}</span>
          <span className={nameStyles.rowAction} aria-hidden="true">{busyTarget === item.id ? <span className={nameStyles.spinner} /> : PLUS_ICON}</span>
        </button>)}
        {loading && Array.from({ length: items.length ? 1 : 3 }, (_, index) => <div key={index} className={nameStyles.skeletonRow} aria-hidden="true" />)}
      </div>
      {loading && <span className={nameStyles.srOnly} role="status">正在读取可编辑歌单</span>}
      {!loading && !items.length && !listError && <p className={nameStyles.empty}>还没有可加入的{source === 'qq' ? '私密' : '自建'}歌单</p>}
      {created && <p className={nameStyles.note}>已新建「{created.name}」。{error ? '歌曲尚未确认加入，歌单会保留。' : '正在加入歌曲…'}</p>}
      {listError && <div className={nameStyles.notice}><span role="alert">{listError}</span><button type="button" disabled={task.busy || loading} onClick={() => setReload(value => value + 1)}>刷新歌单</button></div>}
      {error && <p className={nameStyles.error} role="alert">{error}</p>}
      {error && !listError && <div className={nameStyles.notice}><span /><button type="button" disabled={task.busy || loading} onClick={() => setReload(value => value + 1)}>刷新歌单</button></div>}
    </>}
    <div className={nameStyles.actions}>
      <button type="button" className={nameStyles.ghost} onClick={close} title={task.busy ? '已发送的平台操作不会被撤回' : undefined}>取消</button>
    </div>
  </>
}
