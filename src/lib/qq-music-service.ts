import { api } from './api'
import { qqLyricIdentifiers } from './qq-lyric-identifiers'
import { qqRelatedSongId } from './qq-related-identifiers'
import type {
  MusicService,
  PlaylistSkeleton,
  RadarPlaylist,
  RelatedPlaylistsPage,
  ToplistGroup,
  ToplistPreviewTrack,
} from './music-service'
import type { Track, Playlist, LyricLine, ArtistInfo } from '../types/domain'

export class QQMusicService implements MusicService {
  async getRecommendPlaylists(page = 0): Promise<Playlist[]> {
    const res = await api.get<{ playlists: Playlist[] }>('/api/qq/recommend/playlists', { page })
    return res.playlists ?? []
  }

  async getPlaylistSkeleton(id: unknown): Promise<PlaylistSkeleton> {
    const res = await api.get<{ trackIds?: unknown[]; tracks: Track[] }>('/api/qq/playlist/tracks', { id: id as string | number })
    const tracks = res.tracks ?? []
    // 服务端已按上游分页取全；显式 trackIds 用于锁定完整顺序，兼容旧响应时再由 tracks 推导。
    return { trackIds: res.trackIds ?? tracks.map((t) => t.id), tracks }
  }

  async getTracksByIds(): Promise<Track[]> {
    // QQ skeleton 全量返回,不存在 pending 窗口;仅为接口完整性
    return []
  }

  async searchTracks(keyword: string): Promise<Track[]> {
    const res = await api.get<{ songs: Track[] }>('/api/qq/search', { keywords: keyword, limit: 20 })
    return res.songs ?? []
  }

  async searchArtists(keyword: string): Promise<ArtistInfo[]> {
    const res = await api.get<{ artists: ArtistInfo[] }>('/api/qq/search/artists', { keywords: keyword, limit: 5 })
    return (res.artists ?? []).map((a) => ({ ...a, source: 'qq' as const }))
  }

  async getSearchHotkeys(): Promise<string[]> {
    const res = await api.get<{ keywords?: string[] }>('/api/qq/search/hotkeys')
    return res.keywords ?? []
  }

  async getSimilarTracks(track: Track): Promise<Track[]> {
    const songid = qqRelatedSongId(track)
    if (songid === null) return []
    const res = await api.get<{ songs?: Track[] }>('/api/qq/song/similar', { songid })
    return res.songs ?? []
  }

  async getRelatedPlaylists(track: Track, previousIds: string[] = []): Promise<RelatedPlaylistsPage> {
    const songid = qqRelatedSongId(track)
    if (songid === null) return { playlists: [], hasMore: false }
    const res = await api.get<RelatedPlaylistsPage>('/api/qq/song/related-playlists', {
      songid, previousIds: previousIds.join(','),
    })
    return { playlists: res.playlists ?? [], hasMore: res.hasMore === true }
  }

  async getArtistDetail(id: unknown): Promise<ArtistInfo> {
    const res = await api.get<{ artist: ArtistInfo }>('/api/qq/artist/detail', { mid: String(id) })
    return res.artist
  }

  async getSimilarArtists(id: unknown): Promise<ArtistInfo[]> {
    const res = await api.get<{ artists?: ArtistInfo[] }>('/api/qq/artist/similar', {
      mid: String(id),
      limit: 10,
    })
    return (res.artists ?? []).map((artist) => ({ ...artist, source: 'qq' as const }))
  }

  async getArtistSongs(id: unknown): Promise<Track[]> {
    const res = await api.get<{ songs: Track[] }>('/api/qq/artist/songs', { id: id as string | number })
    return res.songs ?? []
  }

  async getArtistAlbums(id: unknown): Promise<Playlist[]> {
    const res = await api.get<{ albums: Playlist[] }>('/api/qq/artist/albums', { id: id as string | number })
    return res.albums ?? []
  }

  async getAlbumDetail(id: unknown): Promise<Playlist | null> {
    const res = await api.get<{ playlist?: Playlist | null }>('/api/qq/album/detail', { mid: String(id) })
    return res.playlist ?? null
  }

  async getAlbumTracks(id: unknown): Promise<Track[]> {
    const res = await api.get<{ songs: Track[] }>('/api/qq/album/songs', { mid: String(id) })
    return res.songs ?? []
  }

  async getTrackUrl(track: Track): Promise<string> {
    const res = await api.get<{ url: string }>('/api/qq/song/url', { id: track.id as string | number, mid: track.mid as string | undefined })
    return res.url ?? ''
  }

  async getLyrics(track: Track): Promise<LyricLine[]> {
    const res = await api.get<{ lines: LyricLine[] }>('/api/qq/lyric', qqLyricIdentifiers(track))
    return res.lines ?? []
  }

  async getDailySongs(): Promise<Track[]> {
    const res = await api.get<{ songs: Track[] }>('/api/qq/recommend/songs')
    return res.songs ?? []
  }

  async getRadarPlaylist(): Promise<RadarPlaylist | null> {
    const res = await api.get<{ playlist: Playlist | null; tracks: Track[] }>('/api/qq/radar')
    if (!res.playlist || !res.tracks?.length) return null
    return { playlist: res.playlist, tracks: res.tracks }
  }

  async getToplists(): Promise<ToplistGroup[]> {
    const res = await api.get<{ groups?: ToplistGroup[] }>('/api/qq/toplist')
    return res.groups ?? []
  }

  async getToplistPreview(id: unknown): Promise<ToplistPreviewTrack[]> {
    const res = await api.get<{ preview?: ToplistPreviewTrack[] }>('/api/qq/toplist/preview', {
      id: String(id),
    })
    return res.preview ?? []
  }

  async getUserPlaylists(): Promise<Playlist[]> {
    const res = await api.get<{ playlists?: Playlist[] }>('/api/qq/user/playlists')
    return res.playlists ?? []
  }

  async getLikedPlaylist(): Promise<Playlist | null> {
    const res = await api.get<{ playlist?: Playlist | null }>('/api/qq/liked/playlist')
    return res.playlist ?? null
  }
}
