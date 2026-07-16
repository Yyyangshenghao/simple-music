import { api } from './api'
import type { MusicService, PlaylistSkeleton, RadarPlaylist } from './music-service'
import type { Track, Playlist, LyricLine, ArtistInfo } from '../types/domain'

export class QQMusicService implements MusicService {
  async getRecommendPlaylists(page = 0): Promise<Playlist[]> {
    const res = await api.get<{ playlists: Playlist[] }>('/api/qq/recommend/playlists', { page })
    return res.playlists ?? []
  }

  async getPlaylistSkeleton(id: unknown): Promise<PlaylistSkeleton> {
    const res = await api.get<{ tracks: Track[] }>('/api/qq/playlist/tracks', { id: id as string | number })
    const tracks = res.tracks ?? []
    // QQ 一次全量返回,骨架即全部曲目,无未加载窗口
    return { trackIds: tracks.map((t) => t.id), tracks }
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

  async getArtistDetail(id: unknown): Promise<ArtistInfo> {
    const res = await api.get<{ artist: ArtistInfo }>('/api/qq/artist/detail', { id: id as string | number })
    return res.artist
  }

  async getArtistSongs(id: unknown): Promise<Track[]> {
    const res = await api.get<{ songs: Track[] }>('/api/qq/artist/songs', { id: id as string | number })
    return res.songs ?? []
  }

  async getArtistAlbums(id: unknown): Promise<Playlist[]> {
    const res = await api.get<{ albums: Playlist[] }>('/api/qq/artist/albums', { id: id as string | number })
    return res.albums ?? []
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
    const res = await api.get<{ lines: LyricLine[] }>('/api/qq/lyric', { id: track.id as string | number, mid: track.mid as string | undefined })
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
}
