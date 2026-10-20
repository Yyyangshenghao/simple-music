import { api } from './api'
// import { qqLyricIdentifiers } from './qq-lyric-identifiers' // 旧歌词直取路径
import { qqRelatedSongId } from './qq-related-identifiers'
import { requestProviderData } from './provider-request-cache'
import { providerAccountSession } from './provider-account-session'
import type {
  ArtistSongsPage,
  MusicService,
  PlaylistSkeleton,
  RadarPlaylist,
  RelatedPlaylistsPage,
  ToplistGroup,
  ToplistPreviewTrack,
} from './music-service'
import type { Track, Playlist, LyricLine, ArtistInfo } from '../types/domain'
import type { PlaylistManagementSession, PlatformPlaylistRef, PlatformPlaylistInspection, PlatformPlaylistMutation, PlatformPlaylistMutationResult } from '../types/platform-playlist'

export class QQMusicService implements MusicService {
  async checkLiked(ids: unknown[]): Promise<Record<string, boolean>> {
    const session = providerAccountSession('qq')
    const mids = [...new Set(ids.map(String))]
    const liked: Record<string, boolean> = {}
    for (let offset = 0; offset < mids.length; offset += 100) {
      const result = await api.post<{ success: boolean; liked?: Record<string, boolean>; error?: string }>('/api/qq/song/like/check', { ids: mids.slice(offset, offset + 100) })
      if (session !== providerAccountSession('qq')) throw new Error('QQ 账号已变化，请重试')
      if (!result.success || !result.liked) throw new Error(result.error || 'QQ 音乐收藏状态读取失败')
      Object.assign(liked, result.liked)
    }
    return liked
  }

  async likeTrack(track: Track, like: boolean): Promise<boolean> {
    if (track.source !== 'qq') throw new Error('只能操作 QQ 音乐歌曲的收藏')
    const accountSession = providerAccountSession('qq')
    const session = await this.getPlaylistManagementSession()
    if (accountSession !== providerAccountSession('qq')) throw new Error('QQ 账号已变化，请重试')
    const result = await api.post<{ success: boolean; liked?: boolean; error?: string }>('/api/qq/song/like', { ...session, like,
      track: { source: 'qq', id: String(track.id), qqId: track.qqId === undefined ? undefined : String(track.qqId), songType: track.songType } })
    if (!result.success || result.liked !== like) throw new Error(result.error || 'QQ 音乐未确认收藏变更，请重试')
    if (accountSession !== providerAccountSession('qq')) throw new Error('QQ 账号已变化，请重试')
    return true
  }

  getPlaylistManagementSession(signal?: AbortSignal): Promise<PlaylistManagementSession> {
    return api.get('/api/qq/playlist-management/session', undefined, { signal })
  }

  inspectPlatformPlaylist(input: PlatformPlaylistRef, signal?: AbortSignal): Promise<PlatformPlaylistInspection> {
    return api.post('/api/qq/playlist-management/inspect', input, undefined, { signal, timeoutMs: 120000 })
  }

  mutatePlatformPlaylist(input: PlatformPlaylistMutation, signal?: AbortSignal): Promise<PlatformPlaylistMutationResult> {
    return api.post('/api/qq/playlist-management/manage', input, undefined, { signal, timeoutMs: 120000 })
  }

  async getPlaybackAccountToken(): Promise<string | null> {
    const result = await api.get<{ accountToken: string | null }>('/api/qq/playback/session')
    return result.accountToken
  }

  async reportPlayback(trackId: unknown, opts: { seconds: number; accountToken?: string; songId?: unknown }): Promise<void> {
    const result = await api.post<{ ok: boolean }>('/api/qq/scrobble', {
      id: trackId, songId: opts.songId, time: Math.floor(opts.seconds), accountToken: opts.accountToken,
    })
    if (!result.ok) throw new Error('PLAYBACK_REPORT_REJECTED')
  }

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

  async searchAlbums(keyword: string): Promise<Playlist[]> {
    const res = await api.get<{ albums: Playlist[] }>('/api/qq/search/albums', { keywords: keyword })
    return res.albums ?? []
  }

  async searchPlaylists(keyword: string): Promise<Playlist[]> {
    const res = await api.get<{ playlists: Playlist[] }>('/api/qq/search/playlists', { keywords: keyword })
    return res.playlists ?? []
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
    return (await this.getArtistSongsPage(id, 0, 50)).songs
  }

  async getArtistSongsPage(id: unknown, offset: number, limit: number): Promise<ArtistSongsPage> {
    const res = await api.get<{ songs?: Track[]; total?: number }>('/api/qq/artist/songs', {
      id: id as string | number,
      offset,
      limit,
    })
    const songs = res.songs ?? []
    const total = Number(res.total)
    return {
      songs,
      nextOffset: offset + limit,
      hasMore: Number.isFinite(total) ? offset + limit < total : songs.length === limit,
    }
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

  /**
   * 复用 QQ 歌词解析及缓存供刷歌选段
   *
   * @param track 目标曲目
   */
  async getLyrics(track: Track): Promise<LyricLine[]> {
    // 旧方案依赖不存在的 lines 字段
    // const res = await api.get<{ lines: LyricLine[] }>('/api/qq/lyric', qqLyricIdentifiers(track))
    // return res.lines ?? []
    // 延迟加载共享歌词模块 避免 provider 初始化循环
    const { fetchLyrics } = await import('./lyrics-fetch')
    // 读取共享解析结果
    return (await fetchLyrics(track)).main
  }

  async getDailySongs(): Promise<Track[]> {
    const res = await api.get<{ songs: Track[] }>('/api/qq/recommend/daily')
    return res.songs ?? []
  }

  async getRadioSongs(): Promise<Track[]> {
    const res = await api.get<{ songs: Track[] }>('/api/qq/recommend/songs')
    return res.songs ?? []
  }

  getRecentTracks(): Promise<Track[]> {
    const session = providerAccountSession('qq')
    return requestProviderData('qq', `history:recent-tracks:${session}`, async () => {
      const res = await api.get<{ songs: Track[] }>('/api/qq/history/recent-tracks')
      if (session !== providerAccountSession('qq')) throw new Error('QQ 账号已变化，请重试')
      return res.songs ?? []
    }, { maxAgeMs: 30_000 })
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
