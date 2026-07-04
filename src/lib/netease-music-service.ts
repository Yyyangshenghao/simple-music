import { api } from './api'
import type { MusicService, RadarPlaylist } from './music-service'
import type { Track, Playlist, LyricLine, ArtistInfo } from '../types/domain'

export class NeteaseMusicService implements MusicService {
  async getRecommendPlaylists(): Promise<Playlist[]> {
    const res = await api.get<{ playlists: Playlist[] }>('/api/netease/recommend/playlists')
    return res.playlists ?? []
  }

  async getPlaylistDetail(id: unknown): Promise<Track[]> {
    const res = await api.get<{ tracks: Track[] }>('/api/playlist/tracks', { id: id as string | number })
    return res.tracks ?? []
  }

  async searchTracks(keyword: string): Promise<Track[]> {
    const res = await api.get<{ songs: Track[] }>('/api/search', { keywords: keyword, limit: 20 })
    return res.songs ?? []
  }

  async searchArtists(keyword: string): Promise<ArtistInfo[]> {
    const res = await api.get<{ artists: ArtistInfo[] }>('/api/search/artists', { keywords: keyword, limit: 5 })
    return (res.artists ?? []).map((a) => ({ ...a, source: 'netease' as const }))
  }

  async getArtistDetail(id: unknown): Promise<ArtistInfo> {
    const res = await api.get<{ artist: ArtistInfo }>('/api/netease/artist/detail', { id: id as string | number })
    return res.artist
  }

  async getArtistSongs(id: unknown): Promise<Track[]> {
    const res = await api.get<{ songs: Track[] }>('/api/netease/artist/songs', { id: id as string | number, limit: 50 })
    return res.songs ?? []
  }

  async getArtistAlbums(id: unknown): Promise<Playlist[]> {
    const res = await api.get<{ albums: Playlist[] }>('/api/netease/artist/albums', { id: id as string | number, limit: 20 })
    return res.albums ?? []
  }

  async getTrackUrl(track: Track): Promise<string> {
    const res = await api.get<{ url: string }>('/api/song/url', { id: track.id as string | number })
    return res.url ?? ''
  }

  async getLyrics(track: Track): Promise<LyricLine[]> {
    const res = await api.get<{ lines: LyricLine[] }>('/api/lyric', { id: track.id as string | number })
    return res.lines ?? []
  }

  async getDailySongs(): Promise<Track[]> {
    const res = await api.get<{ songs: Track[] }>('/api/netease/recommend/songs')
    return res.songs ?? []
  }

  async getRadarPlaylist(): Promise<RadarPlaylist | null> {
    const res = await api.get<{ playlist: Playlist | null; tracks: Track[] }>('/api/netease/radar')
    if (!res.playlist || !res.tracks?.length) return null
    return { playlist: res.playlist, tracks: res.tracks }
  }
}
