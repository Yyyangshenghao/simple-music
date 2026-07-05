import type { Track, Playlist, LyricLine, ArtistInfo } from '../types/domain'

export interface MusicService {
  /** 推荐歌单分页拉取：page 0 为个性化推荐，之后每页拉更远的一批（可无限翻页的音源按 page 返回不同内容）。 */
  getRecommendPlaylists(page?: number): Promise<Playlist[]>
  getPlaylistDetail(id: unknown): Promise<Track[]>
  searchTracks(keyword: string): Promise<Track[]>
  searchArtists(keyword: string): Promise<ArtistInfo[]>
  getArtistDetail(id: unknown): Promise<ArtistInfo>
  getArtistSongs(id: unknown): Promise<Track[]>
  getArtistAlbums(id: unknown): Promise<Playlist[]>
  getTrackUrl(track: Track): Promise<string>
  getLyrics(track: Track): Promise<LyricLine[]>
  /** 每日歌曲推荐（网易专属；未实现的音源不渲染每日推荐卡）。 */
  getDailySongs?(): Promise<Track[]>
  /** 私人雷达歌单（网易专属；null = 不可用，隐藏卡片）。 */
  getRadarPlaylist?(): Promise<RadarPlaylist | null>
  /** 最近播放歌单（网易专属，账号级播放记录；空数组 = 未登录或无记录，隐藏栏目）。 */
  getRecentPlaylists?(): Promise<Playlist[]>
}

export interface RadarPlaylist {
  playlist: Playlist
  tracks: Track[]
}
