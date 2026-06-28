import { api } from './api'
import type { MusicService } from './music-service'
import type { Banner, Track, Playlist, LyricLine, ArtistInfo } from '../types/domain'

export class QQMusicService implements MusicService {
  async getRecommendBanners(): Promise<Banner[]> { return [] }

  async getRecommendPlaylists(): Promise<Playlist[]> {
    const res = await api.get<{ playlists: Playlist[] }>('/api/qq/playlists/discover')
    return res.playlists ?? []
  }

  async getNewSongs(): Promise<Track[]> { return [] }

  async getPlaylistDetail(id: unknown): Promise<Track[]> {
    const res = await api.get<{ songs: Track[] }>('/api/qq/playlist/detail', { id: id as string | number })
    return res.songs ?? []
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

  async getTrackUrl(track: Track): Promise<string> {
    const res = await api.get<{ url: string }>('/api/qq/song/url', { id: track.id as string | number, mid: track.mid as string | undefined })
    return res.url ?? ''
  }

  async getLyrics(track: Track): Promise<LyricLine[]> {
    const res = await api.get<{ lines: LyricLine[] }>('/api/qq/lyric', { id: track.id as string | number, mid: track.mid as string | undefined })
    return res.lines ?? []
  }
}
