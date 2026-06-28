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
}
