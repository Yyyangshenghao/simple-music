import { providerFor } from '../providers/registry'
import { isProviderParticipating } from '../stores/providers'
import { appPlaylistTrackKey, useAppPlaylistsStore, type AppPlaylist } from '../stores/app-playlists'
import { providerAccountSession } from './provider-account-session'
import { clearProviderRequestCache } from './provider-request-cache'
import type { PlaylistSyncSession } from '../types/playlist-sync'

const pending = new Map<string, Promise<void>>()

export function appPlaylistSyncContent(item: Pick<AppPlaylist, 'name' | 'tracks'>): string {
  return JSON.stringify([item.name, item.tracks.map(appPlaylistTrackKey)])
}

export function appPlaylistSyncReason(item: AppPlaylist, linked = false): string {
  if (!item.tracks.length && !linked) return '歌单中还没有歌曲'
  if (item.tracks.some(track => track.source !== 'netease')) return '仅支持全部歌曲来自网易云的歌单'
  if (item.tracks.some(track => !/^[1-9]\d*$/.test(String(track.id)))) return '部分歌曲缺少有效的网易云 ID'
  return ''
}

export function syncAppPlaylist(id: string, session: PlaylistSyncSession): Promise<void> {
  const running = pending.get(id)
  if (running) return running
  if (pending.size >= 32) return Promise.reject(new Error('正在同步其他歌单，请稍后重试'))
  const work = (async () => {
    const store = useAppPlaylistsStore.getState()
    const item = store.items.find(item => item.id === id)
    if (!item || store.error) throw new Error(store.error || '这个应用歌单已被删除')
    const reason = appPlaylistSyncReason(item, !!item.neteaseSync?.[session.accountId])
    if (reason) throw new Error(reason)
    if (!isProviderParticipating('netease')) throw new Error('请先登录并启用网易云')
    const writer = providerFor('netease').playlistWriter
    if (!writer?.syncAppPlaylist) throw new Error('当前版本不支持网易云歌单同步')
    const epoch = providerAccountSession('netease')
    const content = appPlaylistSyncContent(item)
    const previous = item.neteaseSync?.[session.accountId]
    // 一旦发起更新，旧成功快照不能再代表云端；超时或部分写入失败也应显示待重试。
    if (previous) store.recordNeteaseSync(id, session.accountId, { playlistId: previous.playlistId })
    const result = await writer.syncAppPlaylist({ ...session, appPlaylistId: id, name: item.name,
      tracks: item.tracks.map(track => ({ source: track.source, id: String(track.id) })), playlistId: previous?.playlistId })
    if (epoch !== providerAccountSession('netease') || !isProviderParticipating('netease')) throw new Error('账号已变化，请重新同步')
    if (!useAppPlaylistsStore.getState().items.some(item => item.id === id)) return
    if (result.playlistId) {
      store.recordNeteaseSync(id, session.accountId, { playlistId: result.playlistId,
        ...(result.success ? { syncedContent: content, syncedAt: Date.now() } : {}) })
    }
    if (!result.success || !result.playlistId) throw new Error(result.error || '同步未完成，请稍后重试')
    clearProviderRequestCache('netease')
  })()
  pending.set(id, work)
  void work.finally(() => { if (pending.get(id) === work) pending.delete(id) }).catch(() => {})
  return work
}
