import { api } from './api'
import type { MusicService, PlaylistSkeleton } from './music-service'
import type { ArtistInfo, LyricLine, Playlist, Track } from '../types/domain'

interface AppleResource {
  id: string
  type: string
  attributes?: {
    name?: string
    artistName?: string
    albumName?: string
    curatorName?: string
    durationInMillis?: number
    trackCount?: number
    artwork?: { url?: string }
    description?: { standard?: string }
    playParams?: { catalogId?: string; isLibrary?: boolean }
  }
  relationships?: Record<string, ApplePage>
}
interface ApplePage { data?: AppleResource[]; next?: string }
interface AppleSearch { results?: { songs?: ApplePage; artists?: ApplePage; playlists?: ApplePage[] } }

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
    appleLibrary: resource.type === 'library-songs',
    catalogId: resource.type === 'library-songs' ? a.playParams?.catalogId : resource.id,
  }
}

function mapPlaylist(resource: AppleResource): Playlist {
  const a = resource.attributes ?? {}
  return {
    provider: 'apple', source: 'apple', type: resource.type.includes('albums') ? 'album' : 'playlist',
    id: resource.id, name: a.name ?? '', cover: artwork(resource),
    trackCount: a.trackCount ?? resource.relationships?.tracks?.data?.length ?? 0,
    playCount: 0, creator: a.curatorName ?? a.artistName ?? 'Apple Music',
    description: a.description?.standard,
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
    let next: string | undefined = path
    while (next) {
      if (!next.startsWith('/v1/') || seen.has(next)) throw new Error('Apple Music 分页地址无效')
      seen.add(next)
      const page: ApplePage = await this.request<ApplePage>(next)
      result.push(...page.data ?? [])
      next = page.next
    }
    return result
  }

  async getRecommendPlaylists(page = 0): Promise<Playlist[]> {
    if (page > 0) return []
    const result = await this.request<AppleSearch>(await this.catalog('charts?types=playlists&limit=50'))
    return (result.results?.playlists ?? []).flatMap((chart) => chart.data ?? []).map(mapPlaylist)
  }

  async getPlaylistSkeleton(id: unknown): Promise<PlaylistSkeleton> {
    const value = String(id)
    const path = value.startsWith('p.')
      ? `/v1/me/library/playlists/${encodeURIComponent(value)}/tracks`
      : await this.catalog(`playlists/${encodeURIComponent(value)}/tracks`)
    const tracks = (await this.all(path)).filter((item) => item.type === 'songs' || item.type === 'library-songs').map(mapAppleTrack)
    return { trackIds: tracks.map((track) => track.id), tracks }
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
    const result = await this.request<ApplePage>(await this.catalog(`albums/${encodeURIComponent(String(id))}`))
    return result.data?.[0] ? mapPlaylist(result.data[0]) : null
  }

  async getAlbumTracks(id: unknown): Promise<Track[]> {
    return (await this.all(await this.catalog(`albums/${encodeURIComponent(String(id))}/tracks`))).filter((item) => item.type === 'songs').map(mapAppleTrack)
  }

  async getUserPlaylists(): Promise<Playlist[]> {
    const status = await api.get<{ loggedIn: boolean }>('/api/apple-music/status')
    if (!status.loggedIn) return []
    return (await this.all('/v1/me/library/playlists?limit=100')).map(mapPlaylist)
  }

  async getTrackUrl(track: Track): Promise<string> { return appleMusicTrackUrl(track) }
  async getLyrics(): Promise<LyricLine[]> { return [] }
}
