import { api } from './api'
import { normalizeImageUrl } from './image-size'
import type { MusicService, PlaylistSkeleton } from './music-service'
import type { ArtistInfo, LyricLine, Playlist, Track } from '../types/domain'

/**
 * 哔哩哔哩游客音频能力。searchTracks 用于同曲匹配，searchVideos 保留视频原题和 UP 主。
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
  async searchVideos(keyword: string, signal: AbortSignal): Promise<Track[]> {
    const res = await api.get<{ songs: Track[] }>('/api/bilibili/search', { keywords: keyword, mode: 'browse' }, { signal })
    return res.songs.map((track) => ({ ...track, cover: normalizeImageUrl(track.cover) || undefined }))
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
