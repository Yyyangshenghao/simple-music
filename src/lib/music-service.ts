import type { Track, Playlist, LyricLine, ArtistInfo, Banner } from '../types/domain'

export interface MusicService {
  getRecommendBanners(): Promise<Banner[]>
  getRecommendPlaylists(): Promise<Playlist[]>
  getNewSongs(): Promise<Track[]>
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
}

export interface RadarPlaylist {
  playlist: Playlist
  tracks: Track[]
}
