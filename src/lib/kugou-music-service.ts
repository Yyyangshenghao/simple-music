import { api } from './api'
import type {
  ArtistSongsPage,
  MusicService,
  PlaylistDetailMeta,
  PlaylistSkeleton,
  ToplistGroup,
  ToplistPreviewTrack,
} from './music-service'
import type { ArtistInfo, LyricLine, Playlist, Track } from '../types/domain'
import { useProviderStore } from '../stores/providers'

/** 未登录账号时不请求账号端点，避免 401 被当成登录失效。 */
function accountLinked(): boolean {
  return !!useProviderStore.getState().byId.kugou.accountLinked
}

/**
 * 酷狗音乐：目录、搜索与播放默认走游客接口；扫码登录后 server 改用账号取整曲，
 * 并开放我的歌单（含「我喜欢」）。暂无红心写入、收听上报和歌单写入。Track.id 是 128 档文件 hash。
 */
export class KugouMusicService implements MusicService {
  async getUserPlaylists(): Promise<Playlist[]> {
    if (!accountLinked()) return []
    const res = await api.get<{ playlists?: Playlist[] }>('/api/kugou/user/playlists')
    return res.playlists ?? []
  }

  async getLikedPlaylist(): Promise<Playlist | null> {
    if (!accountLinked()) return null
    return (await this.getUserPlaylists()).find((playlist) => playlist.specialType === 5) ?? null
  }

  async getRecommendPlaylists(page = 0): Promise<Playlist[]> {
    const res = await api.get<{ playlists?: Playlist[] }>('/api/kugou/recommend/playlists', { page })
    return res.playlists ?? []
  }

  async getPlaylistSkeleton(id: unknown): Promise<PlaylistSkeleton> {
    const res = await api.get<{ trackIds?: unknown[]; tracks?: Track[]; playlist?: PlaylistDetailMeta | null }>('/api/kugou/playlist/tracks', { id: String(id) })
    const tracks = res.tracks ?? []
    const meta = res.playlist ? { description: res.playlist.description, creator: res.playlist.creator, playCount: res.playlist.playCount } : undefined
    return { trackIds: res.trackIds ?? tracks.map((t) => t.id), tracks, meta }
  }

  async getTracksByIds(ids: unknown[]): Promise<Track[]> {
    if (!ids.length) return []
    const res = await api.get<{ songs?: Track[] }>('/api/kugou/song/detail', { ids: ids.map(String).join(',') })
    const byId = new Map((res.songs ?? []).map((song) => [String(song.id), song]))
    return ids.map((id) => byId.get(String(id).toLowerCase())).filter((song): song is Track => !!song)
  }

  async searchTracks(keyword: string): Promise<Track[]> {
    const res = await api.get<{ songs?: Track[] }>('/api/kugou/search', { keywords: keyword, limit: 20 })
    return res.songs ?? []
  }

  async searchArtists(keyword: string): Promise<ArtistInfo[]> {
    const res = await api.get<{ artists?: ArtistInfo[] }>('/api/kugou/search/artists', { keywords: keyword, limit: 5 })
    return (res.artists ?? []).map((a) => ({ ...a, source: 'kugou' as const }))
  }

  async searchAlbums(keyword: string): Promise<Playlist[]> {
    const res = await api.get<{ albums?: Playlist[] }>('/api/kugou/search/albums', { keywords: keyword })
    return res.albums ?? []
  }

  async searchPlaylists(keyword: string): Promise<Playlist[]> {
    const res = await api.get<{ playlists?: Playlist[] }>('/api/kugou/search/playlists', { keywords: keyword })
    return res.playlists ?? []
  }

  async getSearchHotkeys(): Promise<string[]> {
    const res = await api.get<{ keywords?: string[] }>('/api/kugou/search/hotkeys')
    return res.keywords ?? []
  }

  async getArtistDetail(id: unknown): Promise<ArtistInfo> {
    const res = await api.get<{ artist: ArtistInfo }>('/api/kugou/artist/detail', { id: String(id) })
    return res.artist
  }

  async getArtistSongs(id: unknown): Promise<Track[]> {
    return (await this.getArtistSongsPage(id, 0, 50)).songs
  }

  async getArtistSongsPage(id: unknown, offset: number, limit: number): Promise<ArtistSongsPage> {
    const res = await api.get<{ songs?: Track[]; total?: number }>('/api/kugou/artist/songs', { id: String(id), offset, limit })
    const songs = res.songs ?? []
    const total = Number(res.total)
    return {
      songs,
      nextOffset: offset + limit,
      hasMore: Number.isFinite(total) && total > 0 ? offset + limit < total : songs.length === limit,
    }
  }

  async getArtistAlbums(id: unknown): Promise<Playlist[]> {
    const res = await api.get<{ albums?: Playlist[] }>('/api/kugou/artist/albums', { id: String(id) })
    return res.albums ?? []
  }

  async getAlbumDetail(id: unknown): Promise<Playlist | null> {
    const res = await api.get<{ playlist?: Playlist | null }>('/api/kugou/album/detail', { id: String(id) })
    return res.playlist ?? null
  }

  async getAlbumTracks(id: unknown): Promise<Track[]> {
    const res = await api.get<{ songs?: Track[] }>('/api/kugou/album/songs', { id: String(id) })
    return res.songs ?? []
  }

  async getTrackUrl(track: Track): Promise<string> {
    const res = await api.get<{ url?: string }>('/api/kugou/song/url', { hash: String(track.id), quality: 'max' })
    return res.url ?? ''
  }

  async getLyrics(track: Track): Promise<LyricLine[]> {
    // 延迟加载共享歌词模块，避免 provider 初始化循环。
    const { fetchLyrics } = await import('./lyrics-fetch')
    return (await fetchLyrics(track)).main
  }

  async getToplists(): Promise<ToplistGroup[]> {
    const res = await api.get<{ groups?: ToplistGroup[] }>('/api/kugou/toplist')
    return res.groups ?? []
  }

  async getToplistPreview(id: unknown): Promise<ToplistPreviewTrack[]> {
    const res = await api.get<{ preview?: ToplistPreviewTrack[] }>('/api/kugou/toplist/preview', { id: String(id) })
    return res.preview ?? []
  }
}
