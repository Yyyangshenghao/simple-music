import { api } from './api'
import { parseLrc } from './lyric-parser'
import type { MusicService, PlaylistSkeleton } from './music-service'
import type { Track, Playlist, LyricLine, ArtistInfo } from '../types/domain'

/**
 * 本地音乐:扫描用户选择的文件夹,不接入在线音源的推荐/艺人/专辑体系(见 LibraryPage 的「本地」tab,
 * 扁平列表展示，不参与在线平台选择或 useLazyPlaylist。
 */

interface LocalTrackRaw {
  id: string
  name: string
  artist: string
  album?: string
  duration?: number
  hasCover: boolean
  mtimeMs?: number
}

interface LocalLyricResponse {
  lyric?: string
  metadata?: { name: string; artist: string; artists?: string[]; album?: string; duration: number; isrc?: string } | null
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
    mtimeMs: raw.mtimeMs,
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

  async getAvailableTracks(ids: unknown[], signal: AbortSignal): Promise<Track[]> {
    const all = await this.listAllTracks()
    const unique = [...new Set(ids.map(String))]
    const available = new Set<string>()
    for (let offset = 0; offset < unique.length; offset += 100) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
      const result = await api.post<{ availableIds: string[] }>('/api/local/availability', { ids: unique.slice(offset, offset + 100) }, undefined, { signal })
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
      for (const id of result.availableIds) available.add(id)
    }
    return all.filter(track => available.has(String(track.id)))
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

  async getLyrics(track: Track, signal?: AbortSignal): Promise<LyricLine[]> {
    return (await this.getLyricSource(track, signal)).lines
  }

  /**
   * 本地歌词（同名 .lrc 或内嵌同步歌词）与在线匹配用的曲目身份。身份只在文件标签给出标题、艺人和时长时存在，
   * 只含这些元数据（及 ISRC），不含路径、封面或音频地址；按文件名回退的曲目不做在线匹配。
   */
  async getLyricSource(track: Track, signal?: AbortSignal): Promise<{ lines: LyricLine[]; identity: Track | null }> {
    const res = await api.get<LocalLyricResponse>('/api/local/lyric', { id: String(track.id) }, { signal })
    const meta = res.metadata
    const identity: Track | null = meta && typeof meta.name === 'string' && typeof meta.artist === 'string'
      && Number.isFinite(meta.duration) && meta.duration > 0
      ? {
          provider: 'local', source: 'local', type: 'local', id: track.id,
          name: meta.name, artist: meta.artist,
          artists: (Array.isArray(meta.artists) ? meta.artists : [meta.artist]).map(name => ({ id: `local:${name}`, name })),
          album: meta.album, duration: meta.duration, ...(meta.isrc ? { isrc: meta.isrc } : {}),
          // 标记：这是由文件标签确认的身份，在线歌词兜底只接受带此标记的本地曲目。
          localTagged: true,
        }
      : null
    return { lines: res.lyric ? parseLrc(res.lyric) : [], identity }
  }
}

export const localMusicService = new LocalMusicService()
