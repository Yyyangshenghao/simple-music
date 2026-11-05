import { api } from './api'
import type { MusicService, PlaylistPage, PlaylistSkeleton } from './music-service'
import type { ArtistInfo, LyricLine, Playlist, Track } from '../types/domain'

interface AppleResource {
  id: string
  type: string
  attributes?: {
    name?: string
    artistName?: string
    albumName?: string
    curatorName?: string
    canEdit?: boolean
    durationInMillis?: number
    isrc?: string
    trackCount?: number
    artwork?: { url?: string }
    description?: { standard?: string }
    title?: { stringForDisplay?: string }
    playParams?: { catalogId?: string; isLibrary?: boolean }
  }
  relationships?: Record<string, ApplePage>
}
interface ApplePage { data?: AppleResource[]; next?: string; meta?: { total?: number } }
interface AppleSearch { results?: { songs?: ApplePage; artists?: ApplePage; playlists?: ApplePage[] } }
export interface AppleRecommendationGroup { id: string; title: string; items: Playlist[] }
export interface AppleRecommendationFeature { item: Playlist; groupTitle: string; moduleId: string }
export interface AppleChartPlaylistsPage { playlists: Playlist[]; nextCursor?: string }
export type AppleChartKind = 'playlists' | 'songs' | 'albums'
export interface AppleChartSongsPage { tracks: Track[]; nextCursor?: string }
export interface AppleChartAlbumsPage { albums: Playlist[]; nextCursor?: string }
/** 目录/推荐歌单默认不带曲目数，需显式 extend；Apple 的 next 游标会丢掉它，跟页时要补回。 */
const TRACK_COUNT_EXTEND = 'extend=trackCount'
function withTrackCount(path: string): string {
  return path.includes(TRACK_COUNT_EXTEND) ? path : `${path}${path.includes('?') ? '&' : '?'}${TRACK_COUNT_EXTEND}`
}
const FAVORITE_SONG_NAMES = new Set(['喜爱歌曲', '喜欢的歌曲', 'favorite songs', 'favourite songs'])

export function appendUniqueAppleCharts(current: Playlist[], incoming: Playlist[]): Playlist[] {
  const known = new Set(current.map(playlist => String(playlist.id)))
  return [...current, ...incoming.filter(playlist => {
    const id = String(playlist.id)
    if (known.has(id)) return false
    known.add(id)
    return true
  })]
}

export function pickAppleRecommendationFeatures(groups: AppleRecommendationGroup[], seed: number): AppleRecommendationFeature[] {
  const seen = new Set<string>()
  return groups.flatMap(group => {
    if (!group.items.length) return []
    let hash = seed | 0
    for (const character of group.id) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619)
    const start = (hash >>> 0) % group.items.length
    for (let offset = 0; offset < group.items.length; offset++) {
      const item = group.items[(start + offset) % group.items.length]
      const key = `${item.type}:${String(item.id)}`
      if (seen.has(key)) continue
      seen.add(key)
      return [{ item, groupTitle: group.title, moduleId: group.id }]
    }
    return []
  })
}

function artwork(resource: AppleResource): string {
  return (resource.attributes?.artwork?.url ?? '').replaceAll('{w}', '600').replaceAll('{h}', '600')
}

export function mapAppleTrack(resource: AppleResource): Track {
  const a = resource.attributes ?? {}
  const artists = (resource.relationships?.artists?.data ?? []).map((artist) => ({
    id: artist.id, name: artist.attributes?.name ?? a.artistName ?? '',
  }))
  return {
    provider: 'apple', source: 'apple', type: 'song', id: resource.id,
    name: a.name ?? '', artist: a.artistName ?? '', artists,
    artistId: artists[0]?.id, album: a.albumName, cover: artwork(resource),
    duration: a.durationInMillis,
    isrc: a.isrc,
    appleLibrary: resource.type === 'library-songs',
    catalogId: resource.type === 'library-songs' ? a.playParams?.catalogId : resource.id,
  }
}

function mapPlaylist(resource: AppleResource): Playlist {
  const a = resource.attributes ?? {}
  const relationship = resource.relationships?.tracks
  const count = a.trackCount ?? relationship?.meta?.total ?? (!relationship?.next ? relationship?.data?.length : undefined)
  return {
    provider: 'apple', source: 'apple', type: resource.type.includes('albums') ? 'album' : 'playlist',
    id: resource.id, name: a.name ?? '', cover: artwork(resource),
    trackCount: count ?? 0,
    ...(resource.type.includes('playlists') || resource.type.includes('albums') ? { trackCountKnown: count !== undefined } : {}),
    playCount: 0, creator: a.curatorName ?? a.artistName ?? 'Apple Music',
    description: a.description?.standard,
    // 资料库里从目录添加的歌单不可编辑，视为收藏。
    ...(resource.type === 'library-playlists' && a.canEdit === false ? { subscribed: true } : {}),
  }
}

function mapArtist(resource: AppleResource): ArtistInfo {
  return { id: resource.id, source: 'apple', name: resource.attributes?.name ?? '', avatar: artwork(resource) }
}

export function appleMusicTrackUrl(track: Track): string {
  const library = track.appleLibrary === true || String(track.id).startsWith('i.')
  const catalogId = typeof track.catalogId === 'string' ? track.catalogId : ''
  return library && !catalogId
    ? `apple-music:library:${encodeURIComponent(String(track.id))}`
    : `apple-music:${encodeURIComponent(catalogId || String(track.id))}`
}

export class AppleMusicService implements MusicService {
  private request<T>(path: string): Promise<T> {
    return api.get<T>('/api/apple-music/catalog', { path })
  }

  private async catalog(path: string): Promise<string> {
    const status = await api.get<{ storefront?: string }>('/api/apple-music/status')
    const storefront = /^[a-z]{2}$/.test(status.storefront ?? '') ? status.storefront! : 'cn'
    return `/v1/catalog/${storefront}/${path}`
  }

  private async all(path: string): Promise<AppleResource[]> {
    const result: AppleResource[] = []
    const seen = new Set<string>()
    const keepTrackCount = path.includes(TRACK_COUNT_EXTEND)
    let next: string | undefined = path
    while (next) {
      if (!next.startsWith('/v1/') || seen.has(next)) throw new Error('Apple Music 分页地址无效')
      seen.add(next)
      const page: ApplePage = await this.request<ApplePage>(next)
      result.push(...page.data ?? [])
      next = page.next && keepTrackCount ? withTrackCount(page.next) : page.next
    }
    return result
  }

  private async playlistWithCount(resource: AppleResource): Promise<Playlist> {
    const playlist = mapPlaylist(resource)
    if (playlist.trackCountKnown !== false) return playlist
    try {
      const page = await this.request<ApplePage>(`/v1/me/library/playlists/${encodeURIComponent(resource.id)}/tracks?limit=1`)
      const count = page.meta?.total ?? (!page.next ? page.data?.length : undefined)
      return typeof count === 'number' && Number.isSafeInteger(count) && count >= 0
        ? { ...playlist, trackCount: count, trackCountKnown: true }
        : playlist
    } catch { return playlist }
  }

  async getRecommendPlaylists(page = 0): Promise<Playlist[]> {
    if (page > 0) return []
    const result = await this.request<AppleSearch>(await this.catalog('charts?types=playlists&limit=50&extend=trackCount'))
    return (result.results?.playlists ?? []).flatMap((chart) => chart.data ?? []).map(mapPlaylist)
  }

  private async chartPage(kind: AppleChartKind, cursor?: string): Promise<ApplePage> {
    if (cursor) {
      const url = new URL(cursor, 'https://api.music.apple.com')
      if (!/^\/v1\/catalog\/[a-z]{2}\/charts\?/.test(cursor)
        || url.searchParams.get('types') !== kind) throw new Error('Apple Music 榜单分页地址无效')
    }
    const path = cursor ?? await this.catalog(`charts?types=${kind}&chart=most-played&limit=24`)
    const result = await this.request<{ results?: Partial<Record<AppleChartKind, ApplePage[]>> }>(withTrackCount(path))
    return result.results?.[kind]?.[0] ?? {}
  }

  async getChartPlaylistsPage(cursor?: string): Promise<AppleChartPlaylistsPage> {
    const chart = await this.chartPage('playlists', cursor)
    return {
      playlists: (chart.data ?? []).filter(item => item.type === 'playlists').map(mapPlaylist),
      nextCursor: chart.next,
    }
  }

  async getChartSongsPage(cursor?: string): Promise<AppleChartSongsPage> {
    const chart = await this.chartPage('songs', cursor)
    return { tracks: (chart.data ?? []).filter(item => item.type === 'songs').map(mapAppleTrack), nextCursor: chart.next }
  }

  async getChartAlbumsPage(cursor?: string): Promise<AppleChartAlbumsPage> {
    const chart = await this.chartPage('albums', cursor)
    return { albums: (chart.data ?? []).filter(item => item.type === 'albums').map(mapPlaylist), nextCursor: chart.next }
  }

  async getStorefrontChartPlaylists(): Promise<Playlist[]> {
    const base = await this.catalog('playlists')
    const storefront = base.split('/')[3]
    const page = await this.request<ApplePage>(`${base}?filter[storefront-chart]=${storefront}&extend=trackCount`)
    return (page.data ?? []).filter(item => item.type === 'playlists').slice(0, 20).map(mapPlaylist)
  }

  async getRecommendationGroups(): Promise<AppleRecommendationGroup[]> {
    const status = await api.get<{ loggedIn: boolean }>('/api/apple-music/status')
    if (!status.loggedIn) return []
    const resources = await this.all('/v1/me/recommendations?extend=trackCount')
    return resources.flatMap(resource => {
      if (resource.type !== 'personal-recommendation') return []
      const title = resource.attributes?.title?.stringForDisplay?.trim()
      const items = (resource.relationships?.contents?.data ?? [])
        .filter(item => (item.type === 'playlists' || item.type === 'albums') && item.attributes?.name)
        .map(mapPlaylist)
      return title && items.length > 0 ? [{ id: resource.id, title, items }] : []
    })
  }

  async getPlaylistSkeleton(id: unknown): Promise<PlaylistSkeleton> {
    const tracks = (await this.all(await this.playlistTracksPath(id))).filter((item) => item.type === 'songs' || item.type === 'library-songs').map(mapAppleTrack)
    return { trackIds: tracks.map((track) => track.id), tracks }
  }

  async getPlaylistPage(id: unknown, offset: number, limit: number): Promise<PlaylistPage> {
    // 目录歌单的曲目分页不带总数，首页并行取一次歌单本身的 trackCount
    const catalogCount = offset === 0 && !String(id).startsWith('p.') ? this.catalogPlaylistTrackCount(id) : null
    const page = await this.request<ApplePage>(`${await this.playlistTracksPath(id)}?limit=${Math.min(100, limit)}&offset=${offset}`)
    const tracks = (page.data ?? []).filter((item) => item.type === 'songs' || item.type === 'library-songs').map(mapAppleTrack)
    const total = page.meta?.total ?? (page.next ? await catalogCount : offset + (page.data?.length ?? 0)) ?? null
    return { tracks, total, nextOffset: offset + (page.data?.length ?? 0), hasMore: !!page.next }
  }

  private async catalogPlaylistTrackCount(id: unknown): Promise<number | null> {
    try {
      const page = await this.request<ApplePage>(await this.catalog(`playlists/${encodeURIComponent(String(id))}?extend=trackCount&fields[playlists]=trackCount`))
      const count = page.data?.[0]?.attributes?.trackCount
      return typeof count === 'number' && Number.isSafeInteger(count) && count >= 0 ? count : null
    } catch { return null }
  }

  private async playlistTracksPath(id: unknown): Promise<string> {
    const value = String(id)
    return value.startsWith('p.')
      ? `/v1/me/library/playlists/${encodeURIComponent(value)}/tracks`
      : this.catalog(`playlists/${encodeURIComponent(value)}/tracks`)
  }

  async getTracksByIds(ids: unknown[]): Promise<Track[]> {
    if (!ids.length) return []
    const values = ids.map(String)
    const result = new Map<string, Track>()
    for (const library of [false, true]) {
      const group = values.filter((id) => id.startsWith('i.') === library)
      if (!group.length) continue
      const base = library ? '/v1/me/library/songs' : await this.catalog('songs')
      for (let offset = 0; offset < group.length; offset += 100) {
        const page = await this.request<ApplePage>(`${base}?ids=${group.slice(offset, offset + 100).map(encodeURIComponent).join(',')}&include=artists`)
        for (const item of page.data ?? []) result.set(item.id, mapAppleTrack(item))
      }
    }
    return values.flatMap((id) => result.has(id) ? [result.get(id)!] : [])
  }

  async searchTracks(keyword: string): Promise<Track[]> {
    const result = await this.request<AppleSearch>(await this.catalog(`search?types=songs&limit=25&include[songs]=artists&term=${encodeURIComponent(keyword)}`))
    return (result.results?.songs?.data ?? []).map(mapAppleTrack)
  }

  async searchArtists(keyword: string): Promise<ArtistInfo[]> {
    const result = await this.request<AppleSearch>(await this.catalog(`search?types=artists&limit=10&term=${encodeURIComponent(keyword)}`))
    return (result.results?.artists?.data ?? []).map(mapArtist)
  }

  async searchAlbums(keyword: string): Promise<Playlist[]> {
    const result = await this.request<{ results?: { albums?: ApplePage } }>(await this.catalog(`search?types=albums&limit=20&term=${encodeURIComponent(keyword)}`))
    return (result.results?.albums?.data ?? []).map(mapPlaylist)
  }

  async searchPlaylists(keyword: string): Promise<Playlist[]> {
    const result = await this.request<{ results?: { playlists?: ApplePage } }>(await this.catalog(`search?types=playlists&limit=20&extend=trackCount&term=${encodeURIComponent(keyword)}`))
    return (result.results?.playlists?.data ?? []).map(mapPlaylist)
  }

  async getArtistDetail(id: unknown): Promise<ArtistInfo> {
    const result = await this.request<ApplePage>(await this.catalog(`artists/${encodeURIComponent(String(id))}`))
    if (!result.data?.[0]) throw new Error('Apple Music 歌手不存在')
    return mapArtist(result.data[0])
  }

  async getArtistSongs(id: unknown): Promise<Track[]> {
    return (await this.all(await this.catalog(`artists/${encodeURIComponent(String(id))}/view/top-songs`))).map(mapAppleTrack)
  }

  async getArtistAlbums(id: unknown): Promise<Playlist[]> {
    return (await this.all(await this.catalog(`artists/${encodeURIComponent(String(id))}/albums`))).map(mapPlaylist)
  }

  async getAlbumDetail(id: unknown): Promise<Playlist | null> {
    const value = String(id)
    const path = value.startsWith('l.') ? `/v1/me/library/albums/${encodeURIComponent(value)}` : await this.catalog(`albums/${encodeURIComponent(value)}`)
    const result = await this.request<ApplePage>(path)
    return result.data?.[0] ? mapPlaylist(result.data[0]) : null
  }

  async getAlbumTracks(id: unknown): Promise<Track[]> {
    const value = String(id)
    const path = value.startsWith('l.') ? `/v1/me/library/albums/${encodeURIComponent(value)}/tracks` : await this.catalog(`albums/${encodeURIComponent(value)}/tracks`)
    return (await this.all(path)).filter((item) => item.type === 'songs' || item.type === 'library-songs').map(mapAppleTrack)
  }

  async getUserPlaylists(): Promise<Playlist[]> {
    const status = await api.get<{ loggedIn: boolean }>('/api/apple-music/status')
    if (!status.loggedIn) return []
    const resources = await this.all('/v1/me/library/playlists?limit=100')
    const playlists: Playlist[] = []
    for (let offset = 0; offset < resources.length; offset += 5) {
      playlists.push(...await Promise.all(resources.slice(offset, offset + 5).map(resource => this.playlistWithCount(resource))))
    }
    return playlists
  }

  async getLikedPlaylist(): Promise<Playlist | null> {
    const status = await api.get<{ loggedIn: boolean }>('/api/apple-music/status')
    if (!status.loggedIn) return null
    const resources = await this.all('/v1/me/library/playlists?limit=100')
    const favorite = resources.find(resource => resource.type === 'library-playlists'
      && FAVORITE_SONG_NAMES.has(resource.attributes?.name?.trim().toLowerCase() ?? ''))
    return favorite ? this.playlistWithCount(favorite) : null
  }

  async getUserAlbums(): Promise<Playlist[]> {
    const status = await api.get<{ loggedIn: boolean }>('/api/apple-music/status')
    if (!status.loggedIn) return []
    return (await this.all('/v1/me/library/albums?limit=100')).filter(item => item.type === 'library-albums').map(mapPlaylist)
  }

  async getTrackUrl(track: Track): Promise<string> { return appleMusicTrackUrl(track) }
  async getLyrics(): Promise<LyricLine[]> { return [] }
}
