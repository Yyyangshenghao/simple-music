import type {
  AudioQuality,
  ArtistInfo,
  LyricLine,
  MusicSource,
  OnlineMusicSource,
  Playlist,
  Track,
} from '../types/domain'
import { ONLINE_MUSIC_SOURCES } from '../types/domain'
import type {
  MusicService,
  PlaylistMeta,
  PlaylistSkeleton,
  RadarPlaylist,
  ToplistGroup,
} from '../lib/music-service'

export const PROVIDER_IDS = ONLINE_MUSIC_SOURCES
export type ProviderId = OnlineMusicSource

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string' && (PROVIDER_IDS as readonly string[]).includes(value)
}

export function providerIdOf(source: MusicSource): ProviderId | null {
  return isProviderId(source) ? source : null
}

export interface ProviderDescriptor {
  id: ProviderId
  label: string
  color: string
  colorSoft: string
  iconKey: string
  defaultEnabled: boolean
}

export interface CatalogCapability {
  getPlaylistSkeleton(id: unknown): Promise<PlaylistSkeleton>
  getTracksByIds(ids: unknown[]): Promise<Track[]>
  searchTracks(keyword: string): Promise<Track[]>
  searchArtists(keyword: string): Promise<ArtistInfo[]>
  getArtistDetail(id: unknown): Promise<ArtistInfo>
  getArtistSongs(id: unknown): Promise<Track[]>
  getArtistAlbums(id: unknown): Promise<Playlist[]>
  getAlbumTracks(id: unknown): Promise<Track[]>
  getSimilarArtists?(id: unknown): Promise<ArtistInfo[]>
}

export interface QualityOption {
  id: string
  label: string
  rank: number
  bitrate?: number
}

export interface PlaybackCandidate {
  source: ProviderId
  track: Track
  quality: QualityOption
  url: string
  trial: boolean
  expiresAt?: number
}

/** provider 明确返回不可播/受限时使用；解析器会继续候选并保留最终用户提示。 */
export class PlaybackUnavailableError extends Error {
  constructor(message: string, readonly reason = 'unavailable') {
    super(message)
    this.name = 'PlaybackUnavailableError'
  }
}

export interface PlaybackCapability {
  getQualities(track: Track): Promise<QualityOption[]>
  resolve(track: Track, quality: AudioQuality, signal?: AbortSignal): Promise<PlaybackCandidate[]>
  getLyrics(track: Track): Promise<LyricLine[]>
}

export type RecommendationKind = 'daily-tracks' | 'radio' | 'radar' | 'playlist-feed'

export interface RecommendationSurface {
  id: string
  source: ProviderId
  kind: RecommendationKind
  title: string
  subtitle?: string
  presentation: 'hero' | 'stack'
  refresh: 'session' | 'daily' | 'paged' | 'stream'
  auth: 'none' | 'optional' | 'required'
}

export type RecommendationContent =
  | { type: 'tracks'; tracks: Track[] }
  | { type: 'playlists'; playlists: Playlist[] }
  | { type: 'radar'; radar: RadarPlaylist | null }

export interface RecommendationPage {
  content: RecommendationContent
  nextCursor?: string
  hasMore: boolean
}

export interface RecommendationCapability {
  listSurfaces(): RecommendationSurface[]
  load(surfaceId: string, cursor?: string): Promise<RecommendationPage>
}

export interface LibraryCapability {
  getUserPlaylists?(): Promise<Playlist[]>
  getLikedPlaylist?(): Promise<Playlist | null>
  checkLiked?(ids: unknown[]): Promise<Record<string, boolean>>
}

export interface HistoryCapability {
  getListeningRanking?(): Promise<Track[]>
  getRecentPlaylists?(): Promise<Playlist[]>
  reportPlayback?(trackId: unknown, opts: { sourceId?: unknown; seconds: number }): Promise<void>
}

export interface PlaylistWriterCapability {
  findUserPlaylistsByName?(name: string): Promise<PlaylistMeta[]>
  getPlaylistWithDescription?(id: unknown): Promise<{ playlist: PlaylistMeta; tracks: Track[] } | null>
  createPlaylist(name: string, opts: { private: boolean }): Promise<{ id: unknown }>
  replacePlaylistTracks(playlistId: unknown, currentTrackIds: unknown[], newTrackIds: unknown[]): Promise<boolean>
  updatePlaylistDescription?(playlistId: unknown, description: string): Promise<boolean>
}

export interface ToplistCapability {
  getToplists(): Promise<ToplistGroup[]>
  getToplistPreview?(id: unknown): Promise<{ name: string; artist: string }[]>
}

export interface MusicProvider {
  descriptor: ProviderDescriptor
  catalog: CatalogCapability
  playback: PlaybackCapability
  recommendations?: RecommendationCapability
  library?: LibraryCapability
  history?: HistoryCapability
  playlistWriter?: PlaylistWriterCapability
  toplists?: ToplistCapability
  /** 阶段 A 兼容层；页面完成迁移后删除。 */
  legacyService: MusicService
}
