import { providerFor } from '../providers/registry'
import { isProviderId } from '../providers/types'
import { isProviderParticipating } from '../stores/providers'
import { providerAccountSession } from './provider-account-session'
import { buildQueue } from './lazy-window'
import type { Playlist, Track } from '../types/domain'

/** 每次操作绑定参与平台的账号；展开中的旧响应不能追加到新会话。 */
export async function resolveBatchTracks(tracks: Track[], collections: Playlist[], signal: AbortSignal): Promise<Track[]> {
  const sources = [...new Set([...tracks, ...collections].map((item) => item.source))]
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
  const known = new Set<string>()
  return result.filter((track) => {
    const key = `${track.source}:${String(track.id)}`
    if (known.has(key) || track.playable === false) return false
    known.add(key)
    return true
  })
}
