import { useEffect, useSyncExternalStore } from 'react'
import { runProviderTasks, type ProviderResult } from '../lib/content-hub'
import { providerAccountSession } from '../lib/provider-account-session'
import { bilibiliService } from '../providers/bilibili-provider'
import { providerFor } from '../providers/registry'
import { PROVIDER_IDS, type ProviderId } from '../providers/types'
import { useProviderStore } from '../stores/providers'
import type { ArtistInfo, Playlist, Track } from '../types/domain'

type Results<T> = Partial<Record<ProviderId, ProviderResult<T[]>>>
interface SearchResults {
  songs: Results<Track>
  artists: Results<ArtistInfo>
  albums: Results<Playlist>
  playlists: Results<Playlist>
}

interface SearchEntry {
  results: SearchResults
  controller: AbortController
}

const EMPTY_RESULTS: SearchResults = { songs: {}, artists: {}, albums: {}, playlists: {} }
const CACHE_LIMIT = 12
const cache = new Map<string, SearchEntry>()
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function notify() {
  for (const listener of listeners) listener()
}

function isLoading(results: SearchResults) {
  const groups: Results<unknown>[] = Object.values(results)
  return groups.some(group => Object.values(group).some(result => result.status === 'loading'))
}

function searchScope(state: ReturnType<typeof useProviderStore.getState>) {
  const sources = PROVIDER_IDS.filter(source => {
    const { enabled, auth } = state.byId[source]
    return enabled && (source === 'bilibili' || auth === 'authenticated')
  })
  return { sources, signature: sources.map(source => `${source}:${providerAccountSession(source)}`).join('|') }
}

let scope = searchScope(useProviderStore.getState())
useProviderStore.subscribe(state => {
  const next = searchScope(state)
  if (next.signature === scope.signature) return
  scope = next
  for (const entry of cache.values()) entry.controller.abort()
  cache.clear()
  notify()
})

function search(keyword: string, mode: 'open' | 'retry' | 'refresh' = 'open') {
  const { sources } = scope
  if (!keyword || !sources.length) return

  const existing = cache.get(keyword)
  if (mode === 'refresh' && existing && isLoading(existing.results)) return
  cache.delete(keyword)
  if (mode === 'refresh') existing?.controller.abort()
  const entry = existing && mode !== 'refresh' ? existing : {
    results: existing?.results ?? EMPTY_RESULTS,
    controller: new AbortController(),
  }
  cache.set(keyword, entry)
  if (existing && mode === 'open') return
  const { controller } = entry
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value!
    cache.get(oldest)?.controller.abort()
    cache.delete(oldest)
  }
  notify()

  function run<T>(
    sources: readonly ProviderId[],
    previous: Results<T>,
    request: (source: ProviderId) => Promise<T[]>,
    apply: (results: SearchResults, result: ProviderResult<T[]>) => SearchResults,
  ) {
    const missing = sources.filter(source => {
      const status = previous[source]?.status
      return mode === 'refresh' || !status || (mode === 'retry' && status === 'error')
    })
    void runProviderTasks(missing, request, {
      signal: controller.signal,
      isEmpty: items => items.length === 0,
      onUpdate: result => {
        const retained = previous[result.source]?.data
        entry.results = apply(entry.results, retained && (result.status === 'loading' || result.status === 'error')
          ? { ...result, data: retained } : result)
        notify()
      },
    })
  }

  const catalog = sources.filter(source => source !== 'bilibili')
  run(sources, entry.results.songs, source => source === 'bilibili'
    ? bilibiliService.searchVideos(keyword, controller.signal)
    : providerFor(source).catalog.searchTracks(keyword),
  (results, result) => ({ ...results, songs: { ...results.songs, [result.source]: result } }))
  run(catalog, entry.results.artists, source => providerFor(source).catalog.searchArtists(keyword),
    (results, result) => ({ ...results, artists: { ...results.artists, [result.source]: result } }))
  run(catalog, entry.results.albums, source => providerFor(source).catalog.searchAlbums?.(keyword) ?? Promise.resolve([]),
    (results, result) => ({ ...results, albums: { ...results.albums, [result.source]: result } }))
  run(catalog, entry.results.playlists, source => providerFor(source).catalog.searchPlaylists?.(keyword) ?? Promise.resolve([]),
    (results, result) => ({ ...results, playlists: { ...results.playlists, [result.source]: result } }))
}

export function useSearchResults(keyword: string, active: boolean) {
  const currentScope = useProviderStore(() => scope)
  const snapshot = () => cache.get(keyword)?.results ?? EMPTY_RESULTS
  const results = useSyncExternalStore(subscribe, snapshot, snapshot)
  useEffect(() => {
    if (active) search(keyword)
  }, [active, keyword, currentScope])

  return {
    ...results,
    ...currentScope,
    busy: !!keyword && currentScope.sources.length > 0 && (!cache.has(keyword) || isLoading(results)),
    refresh: () => search(keyword, 'refresh'),
    retryFailed: () => search(keyword, 'retry'),
  }
}
