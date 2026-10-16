import { useEffect, useMemo, useRef, useState } from 'react'
import { providerFor } from '../../providers/registry'
import { useProviderStore } from '../../stores/providers'
import { useAppPlaylistsStore, type AppPlaylist } from '../../stores/app-playlists'
import { useToastStore } from '../../stores/toast'
import { appPlaylistSyncReason, pullAppPlaylist, readAppPlaylistSnapshot, syncAppPlaylist } from '../../lib/app-playlist-sync'
import { planPlaylistSyncMerge, playlistSyncChanges } from '../../lib/playlist-sync-merge'
import { providerAccountSession } from '../../lib/provider-account-session'
import type { Track } from '../../types/domain'
import type { PlaylistSyncReport, PlaylistSyncSession, PlaylistSyncSnapshot, PlaylistSyncSource } from '../../types/playlist-sync'
import { AppPlaylistSyncDialog } from './AppPlaylistSyncDialog'
import styles from '../../pages/AppPlaylists.module.css'
import syncStyles from './AppPlaylistSync.module.css'

type SyncChanges = ReturnType<typeof playlistSyncChanges>
type SyncChoices = Record<string, 'local' | 'cloud'>

function localSnapshot(item: AppPlaylist): PlaylistSyncSnapshot {
  return { name: item.name, revision: '', tracks: item.tracks.map(track => ({ source: track.source, id: String(track.id),
    ...(track.source === 'qq' && track.qqId !== undefined ? { qqId: String(track.qqId) } : {}),
    ...(track.source === 'qq' && typeof track.songType === 'number' ? { songType: track.songType } : {}) })) }
}

function hasChanges(changes: SyncChanges) {
  return !!(changes.added.length || changes.removed.length || changes.renamed || changes.reordered)
}

function changeSummary(changes: SyncChanges) {
  if (!hasChanges(changes)) return '无更改'
  return [`新增 ${changes.added.length} 首`, `移除 ${changes.removed.length} 首`,
    ...(changes.renamed ? ['名称有更改'] : []), ...(changes.reordered ? ['顺序有更改'] : [])].join(' · ')
}

function unfinished(report: PlaylistSyncReport) {
  return report.matched === null || report.missingIds.length > 0 || report.extraIds.length > 0
    || report.name !== 'done' || report.order === 'pending' || report.order === 'unknown' || report.issues.length > 0
}

function Changes({ label, changes, name, songName }: { label: string; changes: SyncChanges; name: string; songName(id: string): string }) {
  return <div className={syncStyles.changes}>
    <p><strong>{label}</strong><span>{changeSummary(changes)}</span></p>
    {hasChanges(changes) && <details className={syncStyles.details}>
      <summary>查看{label}更改</summary>
      {changes.renamed && <p>歌单名称：{name}</p>}
      {!!changes.added.length && <p>新增：{changes.added.map(songName).join('、')}</p>}
      {!!changes.removed.length && <p>移除：{changes.removed.map(songName).join('、')}</p>}
      {changes.reordered && <p>歌曲顺序有更改</p>}
    </details>}
  </div>
}

function SyncReport({ report, songName, disabled, onRetry }: { report: PlaylistSyncReport; songName(id: string): string; disabled: boolean; onRetry(): void }) {
  const pending = unfinished(report)
  return <div className={syncStyles.report}>
    <p className={styles.hint} role="status">上次推送{report.matched === null ? '结果待确认' : pending ? '部分完成' : '已完成'}：
      {report.added === null ? '加入数量待确认' : `已加入 ${report.added} 首`}，{report.removed === null ? '移除数量待确认' : `已移除 ${report.removed} 首`}，{report.matched === null && !report.missingIds.length ? '未加入数量待确认' : `未加入 ${report.missingIds.length} 首`}。
      {report.name === 'pending' ? ' 名称未完成。' : report.name === 'unknown' ? ' 名称待确认。' : ''}
      {report.order === 'pending' ? ' 顺序未完成。' : report.order === 'unknown' ? ' 顺序待确认。' : ''}</p>
    {report.matched === null && <p className={styles.hint}>平台尚未确认结果，请检查变更后补齐。</p>}
    {pending && <>
      <details className={syncStyles.details}>
        <summary>查看未完成项</summary>
        {!!report.missingIds.length && <p>未加入：{report.missingIds.map(songName).join('、')}</p>}
        {!!report.extraIds.length && <p>未移除：{report.extraIds.map(songName).join('、')}</p>}
        {report.issues.map((issue, index) => <p key={`${issue.step}:${index}`}>{issue.message}</p>)}
      </details>
      <div className={styles.buttons}><button type="button" disabled={disabled} onClick={onRetry}>重试未完成项</button></div>
    </>}
  </div>
}

export function AppPlaylistSync({ item }: { item: AppPlaylist }) {
  const source = item.tracks[0]?.source
  if (item.tracks.length && (source !== 'netease' && source !== 'qq' || item.tracks.some(track => track.source !== source))) {
    return <p className={styles.hint}>仅支持全部歌曲来自网易云或全部来自 QQ 音乐的歌单同步。</p>
  }
  const sources: PlaylistSyncSource[] = item.tracks.length ? [source as PlaylistSyncSource]
    : Object.keys(item.qqSync ?? {}).length ? [...(Object.keys(item.neteaseSync ?? {}).length ? ['netease' as const] : []), 'qq'] : ['netease']
  return <>{sources.map(source => <PlatformPlaylistSync key={`${item.id}:${source}`} item={item} source={source} />)}</>
}

function PlatformPlaylistSync({ item, source }: { item: AppPlaylist; source: PlaylistSyncSource }) {
  const label = source === 'qq' ? 'QQ 音乐' : '网易云'
  const provider = useProviderStore(state => state.byId[source])
  const available = provider.enabled && provider.auth === 'authenticated'
  const epoch = providerAccountSession(source)
  const [session, setSession] = useState<PlaylistSyncSession | null>(null)
  const [sessionError, setSessionError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [busy, setBusy] = useState<'check' | 'pull' | 'push' | null>(null)
  const [error, setError] = useState('')
  const [cloud, setCloud] = useState<PlaylistSyncSnapshot | null>(null)
  const [cloudNames, setCloudNames] = useState<{ snapshot: PlaylistSyncSnapshot; names: Map<string, string> } | null>(null)
  const [showConflicts, setShowConflicts] = useState(false)
  const [latestReport, setLatestReport] = useState<PlaylistSyncReport | null>(null)
  const mounted = useRef(true)
  const currentSession = useRef<PlaylistSyncSession | null>(null)
  const sequence = useRef(0)
  const running = useRef(false)
  const checkController = useRef<AbortController | null>(null)
  const currentCloud = useRef(cloud)
  currentCloud.current = cloud

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; checkController.current?.abort() } }, [])
  useEffect(() => {
    const controller = new AbortController()
    sequence.current += 1
    checkController.current?.abort()
    running.current = false
    currentSession.current = null
    setSession(null)
    setSessionError('')
    setError('')
    setCloud(null)
    setLatestReport(null)
    setShowConflicts(false)
    setBusy(null)
    if (available) {
      const writer = providerFor(source).playlistWriter
      if (!writer?.getPlaylistSyncSession) setSessionError('当前版本不支持歌单同步')
      else void writer.getPlaylistSyncSession(controller.signal).then(next => {
        if (controller.signal.aborted || epoch !== providerAccountSession(source)) return
        currentSession.current = next
        setSession(next)
      }).catch(() => { if (!controller.signal.aborted) setSessionError('账号核实失败，请重试') })
    }
    return () => { controller.abort(); checkController.current?.abort() }
  }, [available, epoch, item.id, refresh, source])

  const link = session ? (source === 'qq' ? item.qqSync : item.neteaseSync)?.[session.accountId] : undefined
  const playlistId = link?.playlistId
  useEffect(() => { setCloud(null); setShowConflicts(false) }, [playlistId])
  const reason = !available ? `请先登录并启用${label}` : appPlaylistSyncReason(item, !!link, source)
  const local = localSnapshot(item)
  const localChanges = link?.base ? playlistSyncChanges(link.base, local, source !== 'qq') : null
  const cloudChanges = link?.base && cloud ? playlistSyncChanges(link.base, cloud) : null
  const cloudChanged = !!cloudChanges && hasChanges(cloudChanges)
  const localChanged = !!localChanges && hasChanges(localChanges)
  const plan = link?.base && cloud ? planPlaylistSyncMerge(link.base, local, cloud, source !== 'qq') : null
  const report = latestReport ?? link?.lastReport
  const songNames = useMemo(() => new Map(item.tracks.filter(track => !track.pending && track.name.trim()).map(track => [String(track.id), track.name])), [item.tracks])
  const songName = (id: string) => songNames.get(id) || (cloudNames?.snapshot === cloud ? cloudNames?.names.get(id) : undefined) || `歌曲 ID ${id}`
  const removeCount = cloud ? playlistSyncChanges(cloud, local, source !== 'qq').removed.length : 0

  useEffect(() => {
    setCloudNames(null)
    if (!cloud || !session || !playlistId || !available || currentSession.current !== session) return
    const checked = cloud, captured = session, operationSequence = sequence.current
    const missing = [...new Set(checked.tracks.slice(0, 10000).filter(track => track.source === source && !songNames.has(track.id)).map(track => track.id))]
    if (!missing.length) return
    const allowed = new Set(missing)
    const names = new Map<string, string>()
    let cancelled = false
    const isCurrent = () => !cancelled && currentCloud.current === checked && active(captured, operationSequence)
    function remember(tracks: Track[]) {
      for (const track of tracks) {
        const id = String(track.id)
        if (track.source === source && allowed.has(id) && !track.pending && typeof track.name === 'string' && track.name.trim()) names.set(id, track.name)
      }
    }
    void (async () => {
      try {
        const catalog = providerFor(source).catalog
        if (source === 'qq') {
          const skeleton = await catalog.getPlaylistSkeleton(playlistId)
          if (!isCurrent()) return
          remember(skeleton.tracks)
        } else {
          for (let offset = 0; offset < missing.length; offset += 100) {
            if (!isCurrent()) return
            const tracks = await catalog.getTracksByIds(missing.slice(offset, offset + 100))
            if (!isCurrent()) return
            remember(tracks)
          }
        }
      } catch { /* 曲名只用于辨识；读取失败保留歌曲 ID，不影响同步。 */ }
      if (isCurrent()) setCloudNames({ snapshot: checked, names })
    })()
    return () => { cancelled = true }
  }, [available, cloud, epoch, playlistId, session, songNames, source])

  function active(captured: PlaylistSyncSession, operationSequence: number) {
    return mounted.current && sequence.current === operationSequence && currentSession.current === captured
      && epoch === providerAccountSession(source) && useAppPlaylistsStore.getState().items.some(saved => saved.id === item.id)
  }

  async function operate(kind: 'check' | 'pull' | 'push', action: (captured: PlaylistSyncSession, operationSequence: number) => Promise<void>) {
    if (!session || !available || running.current || currentSession.current !== session || epoch !== providerAccountSession(source)) return
    const captured = session, operationSequence = sequence.current
    running.current = true
    setBusy(kind)
    setError('')
    try { await action(captured, operationSequence) }
    catch (failure) {
      if (active(captured, operationSequence)) {
        setError(failure instanceof Error ? failure.message : '操作未完成，请检查变更后重试')
        setCloud(null)
        setShowConflicts(false)
      }
    } finally {
      if (active(captured, operationSequence)) { running.current = false; setBusy(null) }
    }
  }

  async function push(captured: PlaylistSyncSession, operationSequence: number, checked?: PlaylistSyncSnapshot) {
    setBusy('push')
    const result = await syncAppPlaylist(item.id, captured, source, checked)
    if (!active(captured, operationSequence)) return
    setCloud(result.snapshot ?? null)
    setLatestReport(result.report ?? null)
    if (result.status === 'complete' && result.report?.matched !== null) useToastStore.getState().show(`已推送到${label}`)
  }

  async function pull(captured: PlaylistSyncSession, operationSequence: number, checked: PlaylistSyncSnapshot, choices?: SyncChoices, initial?: 'local' | 'cloud') {
    setBusy('pull')
    await pullAppPlaylist(item.id, captured, source, checked, choices, initial)
    if (!active(captured, operationSequence)) return
    setCloud(checked)
    setLatestReport(null)
    setShowConflicts(false)
    useToastStore.getState().show(initial === 'local' ? '已保留应用内容，可推送应用更改' : '已拉取并合并云端更改')
  }

  function inspect(retry = false) {
    void operate('check', async (captured, operationSequence) => {
      checkController.current?.abort()
      setCloud(null)
      setShowConflicts(false)
      const controller = new AbortController()
      checkController.current = controller
      const checked = await readAppPlaylistSnapshot(item.id, captured, source, controller.signal)
      if (!active(captured, operationSequence) || controller.signal.aborted) return
      setCloud(checked)
      setShowConflicts(false)
      if (!retry) return
      const latest = useAppPlaylistsStore.getState().items.find(saved => saved.id === item.id)!
      const base = (source === 'qq' ? latest.qqSync : latest.neteaseSync)?.[captured.accountId]?.base
      if (!base) return
      if (hasChanges(playlistSyncChanges(base, checked))) {
        if (planPlaylistSyncMerge(base, localSnapshot(latest), checked, source !== 'qq').conflicts.length) setShowConflicts(true)
        else await pull(captured, operationSequence, checked)
      } else await push(captured, operationSequence, checked)
    })
  }

  function requestPull(choices?: SyncChoices, initial?: 'local' | 'cloud') {
    if (!cloud || running.current) return
    if (!initial && !choices && plan?.conflicts.length) { setShowConflicts(true); return }
    if (choices && session) {
      const latest = useAppPlaylistsStore.getState().items.find(saved => saved.id === item.id)
      const latestLink = latest ? (source === 'qq' ? latest.qqSync : latest.neteaseSync)?.[session.accountId] : undefined
      if (!latest || JSON.stringify(localSnapshot(latest)) !== JSON.stringify(local)
        || latestLink?.playlistId !== playlistId || latestLink?.base?.revision !== link?.base?.revision) {
        setError('应用歌单在选择冲突后有修改，请重新检查并选择')
        setCloud(null)
        setShowConflicts(false)
        return
      }
    }
    void operate('pull', (captured, operationSequence) => pull(captured, operationSequence, cloud, choices, initial))
  }

  return <section className={styles.syncSection} aria-label={`${label}歌单同步`}>
    <div className={styles.buttons}>
      <span className={syncStyles.platform}>{label}</span>
      {link ? <>
        {cloud && link.base && cloudChanged && <button className={styles.primary} type="button" disabled={!!busy || !available} onClick={() => requestPull()}>拉取并合并</button>}
        {cloud && link.base && !cloudChanged && localChanged && <button className={styles.primary} type="button" disabled={!!busy || !!reason} onClick={() => void operate('push', (captured, operationSequence) => push(captured, operationSequence, cloud))}>推送应用更改</button>}
        <button type="button" className={!cloud ? styles.primary : undefined} disabled={!!busy || !session || !available} onClick={() => inspect()}>{busy === 'check' ? '正在检查…' : '检查变更'}</button>
        {cloud && link.base && !cloudChanged && !localChanged && <span className={styles.hint}>两端一致</span>}
      </> : <button className={styles.primary} type="button" disabled={!!reason || !session || !!busy} onClick={() => void operate('push', (captured, operationSequence) => push(captured, operationSequence))}>创建云端歌单</button>}
      {sessionError && available && <button type="button" disabled={!!busy} onClick={() => setRefresh(value => value + 1)}>重试核实账号</button>}
      {busy && busy !== 'check' && <span className={styles.hint} role="status">{busy === 'pull' ? '正在拉取并合并…' : '正在推送…'}</span>}
    </div>
    {(!available || sessionError || !session || !link) && <p className={styles.hint}>{reason || sessionError || (!session ? `正在核实${label}账号…` : `在当前${label}账号创建一份私密歌单。`)}</p>}
    {link && !cloud && !busy && <p className={styles.hint}>先检查两端变更，再选择拉取或推送。</p>}
    {cloud && link?.base && <div className={syncStyles.changeList}>
      <Changes label="应用" changes={localChanges!} name={item.name} songName={songName} />
      <Changes label="云端" changes={cloudChanges!} name={cloud.name} songName={songName} />
    </div>}
    {cloud && link && !link.base && <>
      <p className={styles.hint}>这份关联尚无共同基准。应用 {item.tracks.length} 首，云端 {cloud.tracks.length} 首，请选择首次对齐方式。</p>
      <p className={styles.hint}>采用云端内容会替换应用歌单的名称、歌曲和顺序；保留应用内容只建立比较基准。</p>
      <div className={styles.buttons}>
        <button type="button" disabled={!!busy || !available || !session} onClick={() => requestPull(undefined, 'local')}>保留应用内容，准备推送</button>
        <button type="button" disabled={!!busy || !available || !session} onClick={() => requestPull(undefined, 'cloud')}>采用云端内容</button>
      </div>
    </>}
    {cloud && link?.base && !cloudChanged && localChanged && <p className={styles.hint}>{reason || `推送以应用内容为准，将移除云端额外的 ${removeCount} 首歌曲${!item.tracks.length ? '，清空云端歌曲但保留歌单' : ''}。`}</p>}
    {source === 'qq' && available && session && <p className={styles.hint}>QQ 音乐不支持推送歌曲顺序；拉取可采用云端顺序。</p>}
    {report && <SyncReport report={report} songName={songName} disabled={!!busy || !session || !available || !link} onRetry={() => inspect(true)} />}
    {error && <p className={styles.error} role="alert">{error}</p>}
    {showConflicts && cloud && plan && <AppPlaylistSyncDialog key={JSON.stringify([link?.base?.revision, cloud.revision, local.name, local.tracks])} local={local} cloud={cloud} conflicts={plan.conflicts} songName={songName}
      busy={!!busy} onClose={() => { if (!busy) setShowConflicts(false) }} onSubmit={choices => requestPull(choices)} />}
  </section>
}
