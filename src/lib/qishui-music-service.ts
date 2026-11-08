import { api } from './api'
import type { ArtistSongsPage, MusicService, PlaylistDetailMeta, PlaylistSkeleton } from './music-service'
import type { ArtistInfo, LyricLine, Playlist, Track } from '../types/domain'

export interface QishuiListeningMode {
  id: string
  label: string
  icon?: string
}

export type QishuiListeningTrack = Track & { vipOnly?: boolean }

export async function getQishuiListeningModes(): Promise<QishuiListeningMode[]> {
  return (await api.get<{ modes: QishuiListeningMode[] }>('/api/qishui/listening-modes')).modes
}

export async function getQishuiListeningTracks(mode: string): Promise<QishuiListeningTrack[]> {
  return (await api.get<{ songs: QishuiListeningTrack[] }>('/api/qishui/listening-modes/tracks', { mode })).songs
}

/** 汽水音乐游客服务：只读目录与播放，无账号、红心和歌单写入。 */
export class QishuiMusicService implements MusicService {
  async getRecommendPlaylists(): Promise<Playlist[]> {
    return []
  }

  async getPlaylistSkeleton(id: unknown): Promise<PlaylistSkeleton> {
    const res = await api.get<{ trackIds?: unknown[]; tracks?: Track[]; playlist?: PlaylistDetailMeta }>('/api/qishui/playlist/tracks', { id: String(id) })
    const tracks = res.tracks ?? []
    const meta = res.playlist ? { description: res.playlist.description, creator: res.playlist.creator } : undefined
    return { trackIds: res.trackIds ?? tracks.map((t) => t.id), tracks, meta }
  }

  async getTracksByIds(): Promise<Track[]> {
    // 歌单骨架一次返回全部曲目详情，不存在 pending 窗口。
    return []
  }

  async searchTracks(keyword: string): Promise<Track[]> {
    const res = await api.get<{ songs?: Track[] }>('/api/qishui/search', { keywords: keyword, limit: 20 })
    return res.songs ?? []
  }

  async searchArtists(keyword: string): Promise<ArtistInfo[]> {
    const res = await api.get<{ artists?: ArtistInfo[] }>('/api/qishui/search/artists', { keywords: keyword, limit: 5 })
    return (res.artists ?? []).map((a) => ({ ...a, source: 'qishui' as const }))
  }

  async searchAlbums(keyword: string): Promise<Playlist[]> {
    const res = await api.get<{ albums?: Playlist[] }>('/api/qishui/search/albums', { keywords: keyword })
    return res.albums ?? []
  }

  async searchPlaylists(keyword: string): Promise<Playlist[]> {
    const res = await api.get<{ playlists?: Playlist[] }>('/api/qishui/search/playlists', { keywords: keyword })
    return res.playlists ?? []
  }

  async getArtistDetail(id: unknown): Promise<ArtistInfo> {
    const res = await api.get<{ artist: ArtistInfo }>('/api/qishui/artist/detail', { id: String(id) })
    return res.artist
  }

  async getArtistSongs(id: unknown): Promise<Track[]> {
    const res = await api.get<{ songs?: Track[] }>('/api/qishui/artist/songs', { id: String(id) })
    return res.songs ?? []
  }

  async getArtistSongsPage(id: unknown, offset: number): Promise<ArtistSongsPage> {
    // 网页接口只能拿到一批歌手歌曲，一次给全。
    const songs = offset === 0 ? await this.getArtistSongs(id) : []
    return { songs, nextOffset: offset + songs.length, hasMore: false }
  }

  async getArtistAlbums(id: unknown): Promise<Playlist[]> {
    const res = await api.get<{ albums?: Playlist[] }>('/api/qishui/artist/albums', { id: String(id) })
    return res.albums ?? []
  }

  async getAlbumDetail(id: unknown): Promise<Playlist | null> {
    const res = await api.get<{ playlist?: Playlist | null }>('/api/qishui/album/detail', { id: String(id) })
    return res.playlist ?? null
  }

  async getAlbumTracks(id: unknown): Promise<Track[]> {
    const res = await api.get<{ songs?: Track[] }>('/api/qishui/album/songs', { id: String(id) })
    return res.songs ?? []
  }

  async getTrackUrl(track: Track): Promise<string> {
    const res = await api.get<{ url?: string }>('/api/qishui/song/url', { id: String(track.id) })
    return res.url ?? ''
  }

  async getLyrics(track: Track): Promise<LyricLine[]> {
    // 延迟加载共享歌词模块，避免 provider 初始化循环。
    const { fetchLyrics } = await import('./lyrics-fetch')
    return (await fetchLyrics(track)).main
  }
}
