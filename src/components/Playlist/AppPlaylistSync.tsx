import { useEffect, useRef, useState } from 'react'
import { providerFor } from '../../providers/registry'
import { useProviderStore } from '../../stores/providers'
import { useAppPlaylistsStore, type AppPlaylist } from '../../stores/app-playlists'
import { useToastStore } from '../../stores/toast'
import { appPlaylistSyncContent, appPlaylistSyncReason, syncAppPlaylist } from '../../lib/app-playlist-sync'
import { providerAccountSession } from '../../lib/provider-account-session'
import type { PlaylistSyncSession, PlaylistSyncSource } from '../../types/playlist-sync'
import styles from '../../pages/AppPlaylists.module.css'

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
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const mounted = useRef(true)
  const currentSession = useRef<PlaylistSyncSession | null>(null)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    const controller = new AbortController()
    currentSession.current = null
    setSession(null)
    setSessionError('')
    setError('')
    if (available) {
      const writer = providerFor(source).playlistWriter
      if (!writer?.getPlaylistSyncSession) setSessionError('当前版本不支持歌单同步')
      else void writer.getPlaylistSyncSession(controller.signal).then(next => {
        if (controller.signal.aborted || epoch !== providerAccountSession(source)) return
        currentSession.current = next
        setSession(next)
      }).catch(() => { if (!controller.signal.aborted) setSessionError('账号核实失败，请重试') })
    }
    return () => controller.abort()
  }, [available, epoch, refresh, source])

  const link = session ? (source === 'qq' ? item.qqSync : item.neteaseSync)?.[session.accountId] : undefined
  const reason = (!available ? `请先登录并启用${label}` : '') || appPlaylistSyncReason(item, !!link, source)
  const synced = !!link?.syncedContent && link.syncedContent === appPlaylistSyncContent(item, source)
  async function sync() {
    if (!session || busy) return
    const captured = session
    setBusy(true)
    setError('')
    try {
      await syncAppPlaylist(item.id, captured, source)
      if (mounted.current && currentSession.current === captured && useAppPlaylistsStore.getState().items.some(saved => saved.id === item.id)) {
        useToastStore.getState().show(`已同步${source === 'qq' ? '名称和歌曲' : ''}到${label}`)
      }
    } catch (failure) {
      if (mounted.current && currentSession.current === captured) setError(failure instanceof Error ? failure.message : '同步失败，请重试')
    } finally { if (mounted.current) setBusy(false) }
  }
  return <div className={styles.syncSection}>
    <div className={styles.buttons}>
      <button type="button" disabled={!!reason || !session || busy} onClick={() => void sync()}
        title={reason || (link ? `以当前应用歌单更新云端名称和歌曲${source === 'netease' ? '及顺序' : '，顺序以 QQ 音乐端为准'}` : `在当前${label}账号创建一份私密歌单`)}>
        {busy ? '正在同步…' : link ? `更新${label}歌单` : `同步到${label}`}
      </button>
      {sessionError && !reason && <button type="button" onClick={() => setRefresh(value => value + 1)}>重试核实账号</button>}
      {synced && <span className={styles.hint}>{source === 'qq' ? '名称和歌曲已同步' : '已同步'}</span>}
      {link && !synced && <span className={styles.hint}>{link.syncedContent ? '有更改待同步' : '同步未完成，可重试'}</span>}
    </div>
    <p className={styles.hint}>{reason || sessionError || (!session ? `正在核实${label}账号…` : link && !item.tracks.length
      ? '本次更新会清空云端歌单中的歌曲，歌单本身会保留。' : source === 'qq'
      ? `${link ? '手动更新同一份歌单的名称和歌曲' : '首次同步创建私密歌单'}；顺序以 QQ 音乐端为准。` : link
      ? '手动更新名称、歌曲和顺序；删除应用歌单不会删除云端歌单。'
      : '首次同步创建私密歌单，后续手动更新同一份。')}</p>
    {error && <p className={styles.error} role="alert">{error}</p>}
  </div>
}
