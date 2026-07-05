import type { Track, Playlist, LyricLine, ArtistInfo } from '../types/domain'

export interface MusicService {
  /** 推荐歌单分页拉取：page 0 为个性化推荐，之后每页拉更远的一批（可无限翻页的音源按 page 返回不同内容）。 */
  getRecommendPlaylists(page?: number): Promise<Playlist[]>
  /** 歌单骨架:完整 trackIds(顺序即歌单顺序)+ 已带详情的前缀批次(QQ/小歌单可能就是全部)。 */
  getPlaylistSkeleton(id: unknown): Promise<PlaylistSkeleton>
  /** 按 id 批量补曲目详情;返回顺序与入参一致,查不到的跳过。 */
  getTracksByIds(ids: unknown[]): Promise<Track[]>
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

export interface PlaylistSkeleton {
  trackIds: unknown[]
  tracks: Track[]
}
