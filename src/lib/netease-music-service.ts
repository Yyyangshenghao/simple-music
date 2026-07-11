import { api } from './api'
import type { MusicService, RadarPlaylist, PlaylistSkeleton, PlaylistMeta } from './music-service'
import type { Track, Playlist, LyricLine, ArtistInfo } from '../types/domain'

export class NeteaseMusicService implements MusicService {
  async getRecommendPlaylists(page = 0): Promise<Playlist[]> {
    const res = await api.get<{ playlists: Playlist[] }>('/api/netease/recommend/playlists', { page })
    return res.playlists ?? []
  }

  async getPlaylistSkeleton(id: unknown): Promise<PlaylistSkeleton> {
    const res = await api.get<{ trackIds?: unknown[]; tracks?: Track[] }>('/api/playlist/tracks', { id: id as string | number })
    const tracks = res.tracks ?? []
    const trackIds = res.trackIds?.length ? res.trackIds : tracks.map((t) => t.id)
    return { trackIds, tracks }
  }

  async getTracksByIds(ids: unknown[]): Promise<Track[]> {
    if (ids.length === 0) return []
    const out: Track[] = []
    // 服务端单批上限 200
    for (let i = 0; i < ids.length; i += 200) {
      const batch = ids.slice(i, i + 200)
      const res = await api.get<{ tracks: Track[] }>('/api/song/detail', { ids: batch.map(String).join(',') })
      out.push(...(res.tracks ?? []))
    }
    return out
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

  async getRecentPlaylists(): Promise<Playlist[]> {
    const res = await api.get<{ playlists: Playlist[] }>('/api/netease/recent/playlists')
    return res.playlists ?? []
  }

  async likeTrack(track: Track, like: boolean): Promise<boolean> {
    const res = await api.get<{ code?: number; liked?: boolean }>('/api/song/like', {
      id: String(track.id),
      like: String(like)
    })
    return res.code === 200
  }

  async checkLiked(ids: unknown[]): Promise<Record<string, boolean>> {
    if (!ids.length) return {}
    const res = await api.get<{ liked?: Record<string, boolean> }>('/api/song/like/check', {
      ids: ids.map(String).join(',')
    })
    return res.liked ?? {}
  }

  /** 网易约定:用户歌单列表首个为"我喜欢的音乐"。 */
  async getLikedPlaylist(): Promise<Playlist | null> {
    const res = await api.get<{ playlists?: Playlist[] }>('/api/user/playlists')
    return res.playlists?.[0] ?? null
  }

  async getRadarPlaylist(): Promise<RadarPlaylist | null> {
    const res = await api.get<{ playlist: Playlist | null; tracks: Track[] }>('/api/netease/radar')
    if (!res.playlist || !res.tracks?.length) return null
    return { playlist: res.playlist, tracks: res.tracks }
  }

  async findUserPlaylistsByName(name: string): Promise<PlaylistMeta[]> {
    const res = await api.get<{ playlists?: PlaylistMeta[] }>('/api/user/playlists')
    return (res.playlists ?? []).filter((p) => p.name === name)
  }

  async getPlaylistWithDescription(id: unknown): Promise<{ playlist: PlaylistMeta; tracks: Track[] } | null> {
    const res = await api.get<{ playlist?: PlaylistMeta | null; tracks?: Track[] }>('/api/playlist/tracks', { id: id as string | number })
    if (!res.playlist || !res.playlist.id) return null
    return { playlist: res.playlist, tracks: res.tracks ?? [] }
  }

  async createPlaylist(name: string, opts: { private: boolean }): Promise<{ id: unknown }> {
    const res = await api.post<{ playlist?: { id?: unknown } }>('/api/playlist/create', {
      name,
      privacy: opts.private ? '10' : '0',
    })
    const id = res.playlist?.id
    if (id === undefined || id === null) throw new Error('CREATE_PLAYLIST_FAILED')
    return { id }
  }

  async replacePlaylistTracks(playlistId: unknown, currentTrackIds: unknown[], newTrackIds: unknown[]): Promise<boolean> {
    if (currentTrackIds.length > 0) {
      await api.post('/api/playlist/remove-songs', { pid: playlistId, ids: currentTrackIds.map(String).join(',') })
    }
    if (newTrackIds.length > 0) {
      await api.post('/api/playlist/add-song', { pid: playlistId, ids: newTrackIds.map(String).join(',') })
    }
    return true
  }

  async updatePlaylistDescription(playlistId: unknown, description: string): Promise<boolean> {
    await api.post('/api/playlist/desc/update', { id: playlistId, desc: description })
    return true
  }
}
