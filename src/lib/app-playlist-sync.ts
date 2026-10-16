import { providerFor } from '../providers/registry'
import { isProviderParticipating } from '../stores/providers'
import { appPlaylistTrackKey, useAppPlaylistsStore, type AppPlaylist, type AppPlaylistSyncLink } from '../stores/app-playlists'
import { providerAccountSession, ProviderAuthError } from './provider-account-session'
import { clearProviderRequestCache } from './provider-request-cache'
import { qqRelatedSongId } from './qq-related-identifiers'
import type { PlaylistSyncResult, PlaylistSyncSession, PlaylistSyncSnapshot, PlaylistSyncSource, PlaylistSyncTrack } from '../types/playlist-sync'
import type { Track } from '../types/domain'
import { isPlaylistSyncReport, isPlaylistSyncSnapshot } from './playlist-sync-snapshot'
import { planPlaylistSyncMerge, playlistSyncChanges } from './playlist-sync-merge'

const pending = new Map<string, { kind: 'push' | 'pull'; promise: Promise<unknown> }>()

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

function refsOf(item: Pick<AppPlaylist, 'tracks'>): PlaylistSyncTrack[] {
  return item.tracks.map(track => ({ source: track.source, id: String(track.id),
    ...(track.source === 'qq' ? { qqId: String(qqRelatedSongId(track) ?? track.qqId), songType: track.songType as number | undefined } : {}) }))
}

function linkOf(item: AppPlaylist, accountId: string, source: PlaylistSyncSource): AppPlaylistSyncLink | undefined {
  return (source === 'qq' ? item.qqSync : item.neteaseSync)?.[accountId]
}

function itemOf(id: string): AppPlaylist {
  const store = useAppPlaylistsStore.getState()
  if (store.error) throw new Error(store.error)
  const item = store.items.find(item => item.id === id)
  if (!item) throw new Error('这个应用歌单已被删除')
  return item
}

function guard(source: PlaylistSyncSource) {
  const epoch = providerAccountSession(source)
  return () => {
    if (epoch !== providerAccountSession(source)) throw new Error('账号已变化，请重新检查')
    if (!isProviderParticipating(source)) throw new Error('请先登录并启用对应平台，再检查同步')
  }
}

function hasChanges(changes: ReturnType<typeof playlistSyncChanges>): boolean {
  return !!(changes.added.length || changes.removed.length || changes.renamed || changes.reordered)
}

function exclusive<T>(id: string, source: PlaylistSyncSource, kind: 'push' | 'pull', work: () => Promise<T>): Promise<T> {
  const key = `${source}:${id}`
  const running = pending.get(key)
  if (running) return running.kind === kind ? running.promise as Promise<T> : Promise.reject(new Error('正在处理这份歌单，请稍后重试'))
  if (pending.size >= 32) return Promise.reject(new Error('正在处理其他歌单，请稍后重试'))
  const promise = work()
  pending.set(key, { kind, promise })
  void promise.finally(() => { if (pending.get(key)?.promise === promise) pending.delete(key) }).catch(() => {})
  return promise
}

export async function readAppPlaylistSnapshot(id: string, session: PlaylistSyncSession, source: PlaylistSyncSource, signal?: AbortSignal): Promise<PlaylistSyncSnapshot> {
  const assertCurrent = guard(source)
  assertCurrent()
  const link = linkOf(itemOf(id), session.accountId, source)
  if (!link) throw new Error('这份应用歌单还没有关联云端歌单')
  const reader = providerFor(source).playlistWriter?.readAppPlaylistSnapshot
  if (!reader) throw new Error('当前版本不支持检查云端歌单')
  const snapshot = await reader({ ...session, playlistId: link.playlistId }, signal)
  assertCurrent()
  if (signal?.aborted) throw new DOMException('操作已取消', 'AbortError')
  if (linkOf(itemOf(id), session.accountId, source)?.playlistId !== link.playlistId) throw new Error('云端关联已变化，请重新检查')
  if (!isPlaylistSyncSnapshot(snapshot, source)) throw new Error('云端歌单信息不完整，请稍后重新检查')
  return snapshot
}

export function syncAppPlaylist(id: string, session: PlaylistSyncSession, source: PlaylistSyncSource = 'netease', cloud?: PlaylistSyncSnapshot): Promise<PlaylistSyncResult> {
  return exclusive(id, source, 'push', async () => {
    const assertCurrent = guard(source)
    assertCurrent()
    const item = itemOf(id)
    const previous = linkOf(item, session.accountId, source)
    const reason = appPlaylistSyncReason(item, !!previous, source)
    if (reason) throw new Error(reason)
    const writer = providerFor(source).playlistWriter
    if (!writer?.syncAppPlaylist) throw new Error('当前版本不支持歌单推送')
    let inspected = cloud
    if (previous) {
      if (!previous.base) throw new Error('请先检查并选择首次对齐的内容')
      inspected ??= await readAppPlaylistSnapshot(id, session, source)
      if (!isPlaylistSyncSnapshot(inspected, source)) throw new Error('请先检查云端变更')
      if (hasChanges(playlistSyncChanges(previous.base, inspected))) throw new Error('云端有新修改，请先拉取并合并')
    }
    assertCurrent()
    const record = source === 'qq' ? useAppPlaylistsStore.getState().recordQQSync : useAppPlaylistsStore.getState().recordNeteaseSync
    const content = appPlaylistSyncContent(item, source)
    if (previous) record(id, session.accountId, { ...previous, syncedContent: undefined, lastReport: undefined })
    const result = await writer.syncAppPlaylist({ ...session, appPlaylistId: id, name: item.name, tracks: refsOf(item),
      playlistId: previous?.playlistId, expectedRevision: inspected?.revision })
    assertCurrent()
    if (!useAppPlaylistsStore.getState().items.some(item => item.id === id)) return result
    if (result.status === 'stale') throw new Error(result.error || '云端在检查后又有修改，请重新检查并合并')
    if (result.snapshot && !isPlaylistSyncSnapshot(result.snapshot, source)
      || result.report && !isPlaylistSyncReport(result.report)) throw new Error('平台返回的同步结果无效，请重新检查')
    if (result.playlistId) {
      record(id, session.accountId, { ...previous, playlistId: result.playlistId,
        base: result.snapshot ?? previous?.base, lastReport: result.report,
        syncedContent: result.success && result.snapshot ? content : undefined,
        syncedAt: result.success && result.snapshot ? Date.now() : previous?.syncedAt })
      clearProviderRequestCache(source)
    }
    if (result.status === 'failed' || !result.success && result.status !== 'partial' || !result.playlistId) throw new Error(result.error || '暂时无法推送，请检查后重试')
    if (result.success && !result.snapshot) throw new Error('平台尚未确认推送结果，请重新检查')
    return result
  })
}

export function pullAppPlaylist(
  id: string, session: PlaylistSyncSession, source: PlaylistSyncSource, cloud: PlaylistSyncSnapshot,
  choices: Record<string, 'local' | 'cloud'> = {}, initial?: 'local' | 'cloud',
): Promise<void> {
  return exclusive(id, source, 'pull', async () => {
    const assertCurrent = guard(source)
    assertCurrent()
    if (!isPlaylistSyncSnapshot(cloud, source)) throw new Error('请先检查完整云端歌单')
    const item = itemOf(id)
    const previous = linkOf(item, session.accountId, source)
    if (!previous) throw new Error('云端关联已变化，请重新检查')
    if (item.tracks.some(track => track.source !== source)) throw new Error('应用歌单已混入其他平台的歌曲，请先整理再合并')
    const local = { name: item.name, tracks: refsOf(item) }
    let merged: Pick<PlaylistSyncSnapshot, 'name' | 'tracks'>
    if (previous.base) {
      const plan = planPlaylistSyncMerge(previous.base, local, cloud, source === 'netease', choices)
      if (plan.conflicts.some(conflict => choices[conflict.id] !== 'local' && choices[conflict.id] !== 'cloud')) throw new Error('请先选择冲突的处理方式')
      merged = plan.content
    } else {
      if (!initial) throw new Error('请先选择保留应用内容或采用云端内容')
      merged = initial === 'cloud' ? cloud : local
    }
    const latest = await readAppPlaylistSnapshot(id, session, source)
    if (latest.revision !== cloud.revision) throw new Error('云端在检查后又有修改，请重新检查并处理冲突')
    const metadata = new Map(item.tracks.map(track => [appPlaylistTrackKey(track), track]))
    const missing = merged.tracks.filter(track => !metadata.has(`${track.source}:${track.id}`)
      || metadata.get(`${track.source}:${track.id}`)?.pending)
    const catalog = providerFor(source).catalog
    if (missing.length) {
      if (source === 'qq') {
        try {
          const skeleton = await catalog.getPlaylistSkeleton(previous.playlistId)
          assertCurrent()
          for (const track of skeleton.tracks) if (track.source === source) metadata.set(appPlaylistTrackKey(track), track)
        } catch (error) { assertCurrent(); if (error instanceof ProviderAuthError) throw error }
      } else {
        for (let offset = 0; offset < missing.length; offset += 100) {
          try {
            const tracks = await catalog.getTracksByIds(missing.slice(offset, offset + 100).map(track => track.id))
            assertCurrent()
            for (const track of tracks) if (track.source === source) metadata.set(appPlaylistTrackKey(track), track)
          } catch (error) { assertCurrent(); if (error instanceof ProviderAuthError) throw error }
        }
      }
    }
    const tracks: Track[] = merged.tracks.map(ref => ({
      type: 'song', name: `歌曲 ${ref.id}`, artist: '', artists: [],
      ...(metadata.get(`${ref.source}:${ref.id}`) ?? {}), ...ref, provider: source, source,
    }))
    assertCurrent()
    const currentLink = linkOf(itemOf(id), session.accountId, source)
    if (currentLink?.playlistId !== previous.playlistId || currentLink.base?.revision !== previous.base?.revision) throw new Error('同步基准已变化，请重新检查')
    const aligned = !hasChanges(playlistSyncChanges(cloud, merged, source === 'netease'))
    useAppPlaylistsStore.getState().applyCloudMerge(id, item, merged.name, tracks, source, session.accountId,
      { ...previous, base: cloud, lastReport: undefined, syncedContent: aligned ? appPlaylistSyncContent({ name: merged.name, tracks }, source) : undefined,
        syncedAt: aligned ? Date.now() : previous.syncedAt })
    clearProviderRequestCache(source)
  })
}
