import { providerFor } from '../providers/registry'
import { isProviderId } from '../providers/types'
import { isProviderParticipating } from '../stores/providers'
import { providerAccountSession } from './provider-account-session'
import { buildQueue } from './lazy-window'
import type { Playlist, Track } from '../types/domain'

/** 每次操作绑定参与平台的账号；展开中的旧响应不能追加到新会话。 */
export async function resolveBatchTracks(tracks: Track[], collections: Playlist[], signal: AbortSignal): Promise<Track[]> {
  return expandTracks(tracks, collections, signal, false)
}

/** 收藏已有元数据不要求来源在线，也保留不可播歌曲；展开集合仍绑定该来源账号。 */
export async function resolveAppPlaylistTracks(tracks: Track[], collections: Playlist[], signal: AbortSignal): Promise<Track[]> {
  return expandTracks(tracks, collections, signal, true)
}

async function expandTracks(tracks: Track[], collections: Playlist[], signal: AbortSignal, saving: boolean): Promise<Track[]> {
  const sources = [...new Set((saving ? collections : [...tracks, ...collections]).map((item) => item.source))]
  const sessions = new Map(sources.filter(isProviderId).map((source) => [source, providerAccountSession(source)]))
  const check = () => {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    for (const [source, session] of sessions) {
      if (providerAccountSession(source) !== session || !isProviderParticipating(source)) throw new Error('账号或平台状态已变化，请重新选择')
    }
  }
  check()
  const result = [...tracks]
  // 按选中顺序展开；不写浏览缓存，避免账号切换时污染其他页面。
  for (const collection of collections) {
    check()
    if (!isProviderId(collection.source)) throw new Error('不支持此来源的歌单')
    const catalog = providerFor(collection.source).catalog
    if (collection.type === 'album') result.push(...await catalog.getAlbumTracks(collection.id))
    else {
      const skeleton = await catalog.getPlaylistSkeleton(collection.id)
      const details = new Map(skeleton.tracks.map((track) => [String(track.id), track]))
      result.push(...buildQueue(skeleton.trackIds, skeleton.trackIds.map((id) => details.get(String(id)) ?? null), collection.source))
    }
    check()
  }
  check()
  if (saving) {
    // 长期收藏尽量保存曲名；失效 ID 保留占位，不因平台漏回详情而丢失收藏。
    const pendingSources = [...new Set(result.filter(track => track.pending).map(track => track.source))].filter(isProviderId)
    for (const source of pendingSources) {
      if (!isProviderParticipating(source)) continue
      if (!sessions.has(source)) sessions.set(source, providerAccountSession(source))
      check()
      const ids = [...new Map(result.filter(track => track.source === source && track.pending).map(track => [String(track.id), track.id])).values()]
      const details = new Map<string, Track>()
      for (let offset = 0; offset < ids.length; offset += 100) {
        check()
        const resolved = await providerFor(source).catalog.getTracksByIds(ids.slice(offset, offset + 100))
        check()
        for (const track of resolved) if (track.source === source) details.set(String(track.id), track)
      }
      for (let index = 0; index < result.length; index++) {
        const track = result[index]
        if (track.source === source && track.pending) result[index] = details.get(String(track.id)) ?? track
      }
    }
  }
  check()
  const known = new Set<string>()
  return result.filter((track) => {
    const key = `${track.source}:${String(track.id)}`
    if (known.has(key) || (!saving && track.playable === false)) return false
    known.add(key)
    return true
  })
}
