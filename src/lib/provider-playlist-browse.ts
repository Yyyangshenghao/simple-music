import { providerFor } from '../providers/registry'
import type { RecommendationPage } from '../providers/types'
import { useProviderStore } from '../stores/providers'
import type { Playlist } from '../types/domain'
import { providerAccountSession } from './provider-account-session'
import { BROWSE_CACHE_MAX_AGE_MS, getCachedProviderData, requestProviderData } from './provider-request-cache'

export type PlaylistBrowseSource = 'netease' | 'qq' | 'kugou'

export interface PlaylistBrowseState {
  session: number
  root: RecommendationPage
  playlists: Playlist[]
  nextCursor?: string
  cursors: string[]
  scrollTop: number
}

// 每个平台只保留一个浏览快照；账号或首页缓存失效时一并丢弃。
const snapshots = new Map<PlaylistBrowseSource, PlaylistBrowseState>()

function feed(source: PlaylistBrowseSource) {
  const recommendations = providerFor(source).recommendations
  const surface = recommendations?.listSurfaces().find(item => item.kind === 'playlist-feed')
  if (!recommendations || !surface) throw new Error('这个平台暂时没有推荐歌单')
  return { recommendations, surface, rootScope: `recommendation:${surface.id}:root` }
}

export function canBrowseProviderPlaylists(source: PlaylistBrowseSource): boolean {
  const state = useProviderStore.getState().byId[source]
  return state.enabled && state.auth === 'authenticated'
}

export function getProviderPlaylistBrowse(source: PlaylistBrowseSource): PlaylistBrowseState | undefined {
  const saved = snapshots.get(source)
  if (!saved) return undefined
  if (!canBrowseProviderPlaylists(source) || saved.session !== providerAccountSession(source)
    || saved.root !== getCachedProviderData(source, feed(source).rootScope)) {
    snapshots.delete(source)
    return undefined
  }
  return saved
}

export async function loadProviderPlaylistBrowse(source: PlaylistBrowseSource, previous?: PlaylistBrowseState, force = false): Promise<PlaylistBrowseState | null> {
  if (!canBrowseProviderPlaylists(source)) return null
  const session = providerAccountSession(source)
  if (previous && previous.session !== session) return null
  const { recommendations, surface, rootScope } = feed(source)
  const cursor = previous?.nextCursor
  if (previous && !cursor) return previous
  const scope = cursor ? `recommendation:${surface.id}:${cursor}` : rootScope
  const page = await requestProviderData(source, scope,
    () => recommendations.load(surface.id, cursor),
    { force, maxAgeMs: BROWSE_CACHE_MAX_AGE_MS })
  if (session !== providerAccountSession(source) || !canBrowseProviderPlaylists(source)
    || getCachedProviderData(source, scope) !== page) return null
  if (page.content.type !== 'playlists') throw new Error('平台没有返回有效的歌单列表')

  const playlists = [...(previous?.playlists ?? [])]
  const known = new Set(playlists.map(item => `${item.source}:${String(item.id)}`))
  for (const playlist of page.content.playlists) {
    const key = `${playlist.source}:${String(playlist.id)}`
    if (known.has(key)) continue
    known.add(key)
    playlists.push(playlist)
  }
  const cursors = cursor ? [...(previous?.cursors ?? []), cursor] : []
  const added = playlists.length > (previous?.playlists.length ?? 0)
  const nextCursor = page.hasMore && added && page.nextCursor && !cursors.includes(page.nextCursor)
    ? page.nextCursor : undefined
  const next: PlaylistBrowseState = {
    session, root: previous?.root ?? page, playlists, nextCursor, cursors,
    scrollTop: previous?.scrollTop ?? 0,
  }
  snapshots.set(source, next)
  return next
}
