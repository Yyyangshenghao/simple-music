import { api } from './api'
import type { MusicService, PlaylistSkeleton } from './music-service'
import type { ArtistInfo, LyricLine, Playlist, Track } from '../types/domain'

/**
 * 哔哩哔哩只作跨源兜底：搜索结果只供同曲匹配（server 已把视频标题拆成歌名/歌手读法），
 * 不提供歌单、歌手、专辑、推荐与歌词；播放沿用原曲目的歌词与元数据。
 */
export interface BilibiliAudioCandidate {
  url: string
  level: string
  quality: string
  br: number
}

export interface BilibiliPlayInfo {
  candidates: BilibiliAudioCandidate[]
  expiresAt: number
}

export function bilibiliBvid(track: Track): string {
  return String(track.bvid ?? track.id ?? '')
}

export class BilibiliMusicService implements MusicService {
  async getRecommendPlaylists(): Promise<Playlist[]> { return [] }
  async getPlaylistSkeleton(): Promise<PlaylistSkeleton> { return { trackIds: [], tracks: [] } }
  async getTracksByIds(): Promise<Track[]> { return [] }
  async searchTracks(keyword: string): Promise<Track[]> {
    const res = await api.get<{ songs?: Track[] }>('/api/bilibili/search', { keywords: keyword })
    return res.songs ?? []
  }
  async searchArtists(): Promise<ArtistInfo[]> { return [] }
  async getArtistDetail(id: unknown): Promise<ArtistInfo> { return { id, name: '', avatar: '', source: 'bilibili' } }
  async getArtistSongs(): Promise<Track[]> { return [] }
  async getArtistAlbums(): Promise<Playlist[]> { return [] }
  async getAlbumTracks(): Promise<Track[]> { return [] }
  async getTrackUrl(track: Track): Promise<string> {
    return (await this.getPlayInfo(track)).candidates[0]?.url ?? ''
  }
  async getLyrics(): Promise<LyricLine[]> { return [] }

  getPlayInfo(track: Track, signal?: AbortSignal): Promise<BilibiliPlayInfo> {
    return api.get<BilibiliPlayInfo>('/api/bilibili/song/url', { bvid: bilibiliBvid(track) }, { signal })
  }
}
