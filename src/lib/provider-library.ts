import { providerFor } from '../providers/registry'
import type { ProviderId } from '../providers/types'
import { useLikesStore } from '../stores/likes'
import { BROWSE_CACHE_MAX_AGE_MS, getCachedProviderData, requestProviderData } from './provider-request-cache'
import type { Playlist } from '../types/domain'

/** 我的库在线资料：playlists=自建歌单，collected=收藏的歌单，albums=收藏的专辑。 */
export type ProviderLibraryMode = 'playlists' | 'collected' | 'albums'

// 自建与收藏歌单来自同一个账号歌单列表，共用缓存后按 subscribed 拆分。
const LIBRARY_SCOPES = { playlists: 'library:user-playlists', collected: 'library:user-playlists', albums: 'library:user-albums' }

function libraryScope(source: ProviderId, mode: ProviderLibraryMode): string {
  return LIBRARY_SCOPES[mode] + (source === 'qq' && mode !== 'albums' ? `:${useLikesStore.getState().qqMutationRevision}` : '')
}

function pickLibraryItems(mode: ProviderLibraryMode, items: Playlist[]): Playlist[] {
  if (mode === 'albums') return items
  return items.filter((playlist) => !!playlist.subscribed === (mode === 'collected'))
}

export async function loadProviderLibrary(source: ProviderId, mode: ProviderLibraryMode, force = false): Promise<Playlist[]> {
  const items = await requestProviderData(source, libraryScope(source, mode), async () => {
    const library = providerFor(source).library
    if (mode === 'albums') return library?.getUserAlbums?.() ?? []
    return library?.getUserPlaylists?.() ?? []
  }, { force, maxAgeMs: BROWSE_CACHE_MAX_AGE_MS })
  return pickLibraryItems(mode, items)
}

export function getCachedProviderLibrary(source: ProviderId, mode: ProviderLibraryMode): Playlist[] | undefined {
  const cached = getCachedProviderData<Playlist[]>(source, libraryScope(source, mode))
  return cached && pickLibraryItems(mode, cached)
}
