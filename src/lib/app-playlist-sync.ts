import { providerFor } from '../providers/registry'
import { isProviderParticipating } from '../stores/providers'
import { appPlaylistTrackKey, useAppPlaylistsStore, type AppPlaylist } from '../stores/app-playlists'
import { providerAccountSession } from './provider-account-session'
import { clearProviderRequestCache } from './provider-request-cache'
import { qqRelatedSongId } from './qq-related-identifiers'
import type { PlaylistSyncSession, PlaylistSyncSource } from '../types/playlist-sync'

const pending = new Map<string, Promise<void>>()

export function appPlaylistSyncContent(item: Pick<AppPlaylist, 'name' | 'tracks'>, source: PlaylistSyncSource = 'netease'): string {
  // QQ 当前同步名称和歌曲集合；本地排序不应被误报为可同步的云端更改。
  if (source === 'qq') return JSON.stringify([item.name, item.tracks.map(track => JSON.stringify([String(track.id), String(track.qqId), track.songType])).sort()])
  return JSON.stringify([item.name, item.tracks.map(appPlaylistTrackKey)])
}

export function appPlaylistSyncReason(item: AppPlaylist, linked = false, source: PlaylistSyncSource = 'netease'): string {
  const label = source === 'qq' ? 'QQ 音乐' : '网易云'
  if (!item.tracks.length && !linked) return '歌单中还没有歌曲'
  if (item.tracks.some(track => track.source !== source)) return `仅支持全部歌曲来自${label}的歌单`
  if (source === 'qq') {
    if (item.name.length > 20) return 'QQ 音乐歌单名称最多 20 个字符，请先缩短名称'
    if (item.tracks.some(track => qqRelatedSongId(track) === null || !/^[a-zA-Z0-9]{1,64}$/.test(String(track.id)))) return '部分歌曲缺少有效的 QQ 音乐 ID，请重新从 QQ 音乐加入'
    if (item.tracks.some(track => track.songType !== undefined && (!Number.isSafeInteger(track.songType) || Number(track.songType) < 0))) return '部分歌曲的 QQ 音乐类型无效，请重新加入'
  } else if (item.tracks.some(track => !/^[1-9]\d*$/.test(String(track.id)))) return '部分歌曲缺少有效的网易云 ID'
  return ''
}

export function syncAppPlaylist(id: string, session: PlaylistSyncSession, source: PlaylistSyncSource = 'netease'): Promise<void> {
  const key = `${source}:${id}`
  const running = pending.get(key)
  if (running) return running
  if (pending.size >= 32) return Promise.reject(new Error('正在同步其他歌单，请稍后重试'))
  const work = (async () => {
    const store = useAppPlaylistsStore.getState()
    const item = store.items.find(item => item.id === id)
    if (!item || store.error) throw new Error(store.error || '这个应用歌单已被删除')
    const previous = (source === 'qq' ? item.qqSync : item.neteaseSync)?.[session.accountId]
    const record = source === 'qq' ? store.recordQQSync : store.recordNeteaseSync
    const label = source === 'qq' ? 'QQ 音乐' : '网易云'
    const reason = appPlaylistSyncReason(item, !!previous, source)
    if (reason) throw new Error(reason)
    if (!isProviderParticipating(source)) throw new Error(`请先登录并启用${label}`)
    const writer = providerFor(source).playlistWriter
    if (!writer?.syncAppPlaylist) throw new Error(`当前版本不支持${label}歌单同步`)
    const epoch = providerAccountSession(source)
    const content = appPlaylistSyncContent(item, source)
    // 一旦发起更新，旧成功快照不能再代表云端；超时或部分写入失败也应显示待重试。
    if (previous) record(id, session.accountId, { playlistId: previous.playlistId })
    const result = await writer.syncAppPlaylist({ ...session, appPlaylistId: id, name: item.name,
      tracks: item.tracks.map(track => ({ source: track.source, id: String(track.id),
        ...(source === 'qq' ? { qqId: String(qqRelatedSongId(track)), songType: track.songType as number | undefined } : {}) })), playlistId: previous?.playlistId })
    if (epoch !== providerAccountSession(source) || !isProviderParticipating(source)) throw new Error('账号已变化，请重新同步')
    if (!useAppPlaylistsStore.getState().items.some(item => item.id === id)) return
    if (result.playlistId) {
      record(id, session.accountId, { playlistId: result.playlistId,
        ...(result.success ? { syncedContent: content, syncedAt: Date.now() } : {}) })
    }
    if (!result.success || !result.playlistId) throw new Error(result.error || '同步未完成，请稍后重试')
    clearProviderRequestCache(source)
  })()
  pending.set(key, work)
  void work.finally(() => { if (pending.get(key) === work) pending.delete(key) }).catch(() => {})
  return work
}
