import { api } from './api'
import { parseLrc } from './lyric-parser'
import type { MusicService, PlaylistSkeleton } from './music-service'
import type { Track, Playlist, LyricLine, ArtistInfo } from '../types/domain'

/**
 * 本地音乐:扫描用户选择的文件夹,不接入在线音源的推荐/艺人/专辑体系(见 LibraryPage 的「本地」tab,
 * 扁平列表展示,不走 activeSource 切换或 useLazyPlaylist)。
 */

interface LocalTrackRaw {
  id: string
  name: string
  artist: string
  album?: string
  duration?: number
  hasCover: boolean
}

function toTrack(raw: LocalTrackRaw): Track {
  return {
    provider: 'local',
    source: 'local',
    type: 'local',
    id: raw.id,
    name: raw.name,
    artist: raw.artist,
    artists: raw.artist ? [{ id: `local:${raw.artist}`, name: raw.artist }] : [],
    album: raw.album,
    cover: raw.hasCover ? api.url('/api/local/cover', { id: raw.id }) : undefined,
    duration: raw.duration,
    url: api.url('/api/local/audio', { id: raw.id })
  }
}

export class LocalMusicService implements MusicService {
  async listFolders(): Promise<string[]> {
    const res = await api.get<{ folders: string[] }>('/api/local/tracks')
    return res.folders ?? []
  }

  async listAllTracks(): Promise<Track[]> {
    const res = await api.get<{ tracks: LocalTrackRaw[] }>('/api/local/tracks')
    return (res.tracks ?? []).map(toTrack)
  }

  async addFolder(path: string): Promise<Track[]> {
    const res = await api.post<{ tracks: LocalTrackRaw[] }>('/api/local/scan', { path })
    return (res.tracks ?? []).map(toTrack)
  }

  async removeFolder(path: string): Promise<void> {
    await api.post('/api/local/remove-folder', { path })
  }

  // ---- MusicService 通用接口:本地音乐不支持在线检索/推荐/艺人体系,均给空占位 ----
  async getRecommendPlaylists(): Promise<Playlist[]> {
    return []
  }

  async getPlaylistSkeleton(): Promise<PlaylistSkeleton> {
    return { trackIds: [], tracks: [] }
  }

  async getTracksByIds(ids: unknown[]): Promise<Track[]> {
    const all = await this.listAllTracks()
    const set = new Set(ids.map(String))
    return all.filter((t) => set.has(String(t.id)))
  }

  async searchTracks(keyword: string): Promise<Track[]> {
    const kw = keyword.trim().toLowerCase()
    if (!kw) return []
    const all = await this.listAllTracks()
    return all.filter((t) => t.name.toLowerCase().includes(kw) || t.artist.toLowerCase().includes(kw))
  }

  async searchArtists(): Promise<ArtistInfo[]> {
    return []
  }

  async getArtistDetail(id: unknown): Promise<ArtistInfo> {
    return { id, name: '', avatar: '', source: 'local' }
  }

  async getArtistSongs(): Promise<Track[]> {
    return []
  }

  async getArtistAlbums(): Promise<Playlist[]> {
    return []
  }

  async getAlbumTracks(): Promise<Track[]> {
    return []
  }

  async getTrackUrl(track: Track): Promise<string> {
    return track.url ?? ''
  }

  async getLyrics(track: Track): Promise<LyricLine[]> {
    const res = await api.get<{ lyric: string }>('/api/local/lyric', { id: String(track.id) })
    return res.lyric ? parseLrc(res.lyric) : []
  }
}

export const localMusicService = new LocalMusicService()
