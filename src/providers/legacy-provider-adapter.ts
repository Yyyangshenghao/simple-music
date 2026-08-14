import { fetchTrackQualities } from '../lib/track-qualities'
import { resolveSongUrl } from '../lib/track-preload'
import { normalizeImageUrl } from '../lib/image-size'
import { PlaybackUnavailableError } from './types'
import type { MusicService } from '../lib/music-service'
import type { ArtistInfo, Playlist, Track } from '../types/domain'
import type {
  HistoryCapability,
  LibraryCapability,
  MusicProvider,
  PlaylistWriterCapability,
  ProviderDescriptor,
  RecommendationCapability,
  RecommendationPage,
  RecommendationSurface,
  ToplistCapability,
  ProviderId,
} from './types'

interface LegacyProviderOptions {
  descriptor: ProviderDescriptor
  service: MusicService
  surfaces: RecommendationSurface[]
}

function pageNumber(cursor?: string): number {
  const page = Number(cursor ?? '0')
  return Number.isInteger(page) && page >= 0 ? page : 0
}

function normalizeTrack(track: Track, source: ProviderId): Track {
  return {
    ...track,
    provider: source,
    source,
    cover: normalizeImageUrl(track.cover) || undefined,
  }
}

function normalizeTracks(tracks: Track[], source: ProviderId): Track[] {
  return tracks.map((track) => normalizeTrack(track, source))
}

function normalizePlaylist(playlist: Playlist, source: ProviderId): Playlist {
  return {
    ...playlist,
    provider: source,
    source,
    cover: normalizeImageUrl(playlist.cover),
    tracks: playlist.tracks ? normalizeTracks(playlist.tracks, source) : undefined,
  }
}

function normalizePlaylists(playlists: Playlist[], source: ProviderId): Playlist[] {
  return playlists.map((playlist) => normalizePlaylist(playlist, source))
}

function normalizeArtist(artist: ArtistInfo, source: ProviderId): ArtistInfo {
  return { ...artist, source, avatar: normalizeImageUrl(artist.avatar) }
}

function recommendationCapability(
  service: MusicService,
  source: ProviderId,
  surfaces: RecommendationSurface[]
): RecommendationCapability {
  return {
    listSurfaces: () => surfaces.map((surface) => ({ ...surface })),
    async load(surfaceId, cursor): Promise<RecommendationPage> {
      const surface = surfaces.find((item) => item.id === surfaceId)
      if (!surface) throw new Error(`UNKNOWN_RECOMMENDATION_SURFACE:${surfaceId}`)

      if (surface.kind === 'playlist-feed') {
        const page = pageNumber(cursor)
        const playlists = normalizePlaylists(await service.getRecommendPlaylists(page), source)
        return {
          content: { type: 'playlists', playlists },
          nextCursor: playlists.length > 0 ? String(page + 1) : undefined,
          hasMore: playlists.length > 0,
        }
      }
      if (surface.kind === 'radar') {
        const legacyRadar = await service.getRadarPlaylist?.() ?? null
        const radar = legacyRadar
          ? {
              playlist: normalizePlaylist(legacyRadar.playlist, source),
              tracks: normalizeTracks(legacyRadar.tracks, source),
            }
          : null
        return { content: { type: 'radar', radar }, hasMore: false }
      }

      const tracks = normalizeTracks(await service.getDailySongs?.() ?? [], source)
      return { content: { type: 'tracks', tracks }, hasMore: surface.refresh === 'stream' && tracks.length > 0 }
    },
  }
}

function libraryCapability(service: MusicService, source: ProviderId): LibraryCapability | undefined {
  if (!service.getUserPlaylists && !service.getLikedPlaylist && !service.checkLiked) return undefined
  return {
    getUserPlaylists: service.getUserPlaylists
      ? async () => normalizePlaylists(await service.getUserPlaylists!(), source)
      : undefined,
    getLikedPlaylist: service.getLikedPlaylist
      ? async () => {
          const playlist = await service.getLikedPlaylist!()
          return playlist ? normalizePlaylist(playlist, source) : null
        }
      : undefined,
    checkLiked: service.checkLiked ? (ids) => service.checkLiked!(ids) : undefined,
  }
}

function historyCapability(service: MusicService, source: ProviderId): HistoryCapability | undefined {
  if (!service.getListeningRanking && !service.getRecentPlaylists && !service.reportPlayback) return undefined
  return {
    getListeningRanking: service.getListeningRanking
      ? async () => normalizeTracks(await service.getListeningRanking!(), source)
      : undefined,
    getRecentPlaylists: service.getRecentPlaylists
      ? async () => normalizePlaylists(await service.getRecentPlaylists!(), source)
      : undefined,
    reportPlayback: service.reportPlayback ? (trackId, opts) => service.reportPlayback!(trackId, opts) : undefined,
  }
}

function playlistWriterCapability(service: MusicService, source: ProviderId): PlaylistWriterCapability | undefined {
  if (!service.createPlaylist || !service.replacePlaylistTracks) return undefined
  return {
    findUserPlaylistsByName: service.findUserPlaylistsByName
      ? (name) => service.findUserPlaylistsByName!(name)
      : undefined,
    getPlaylistWithDescription: service.getPlaylistWithDescription
      ? async (id) => {
          const result = await service.getPlaylistWithDescription!(id)
          return result ? { ...result, tracks: normalizeTracks(result.tracks, source) } : null
        }
      : undefined,
    createPlaylist: (name, opts) => service.createPlaylist!(name, opts),
    replacePlaylistTracks: (playlistId, currentTrackIds, newTrackIds) =>
      service.replacePlaylistTracks!(playlistId, currentTrackIds, newTrackIds),
    updatePlaylistDescription: service.updatePlaylistDescription
      ? (playlistId, description) => service.updatePlaylistDescription!(playlistId, description)
      : undefined,
  }
}

function toplistCapability(service: MusicService, source: ProviderId): ToplistCapability | undefined {
  if (!service.getToplists) return undefined
  return {
    getToplists: async () => (await service.getToplists!()).map((group) => ({
      ...group,
      entries: group.entries.map((entry) => ({
        ...entry,
        playlist: normalizePlaylist(entry.playlist, source),
      })),
    })),
    getToplistPreview: service.getToplistPreview ? (id) => service.getToplistPreview!(id) : undefined,
  }
}

export function createLegacyProvider(options: LegacyProviderOptions): MusicProvider {
  const { descriptor, service, surfaces } = options
  return {
    descriptor,
    legacyService: service,
    catalog: {
      getPlaylistSkeleton: async (id) => {
        const skeleton = await service.getPlaylistSkeleton(id)
        return { ...skeleton, tracks: normalizeTracks(skeleton.tracks, descriptor.id) }
      },
      getTracksByIds: async (ids) => normalizeTracks(await service.getTracksByIds(ids), descriptor.id),
      searchTracks: async (keyword) => normalizeTracks(await service.searchTracks(keyword), descriptor.id),
      searchArtists: async (keyword) => (await service.searchArtists(keyword))
        .map((artist) => normalizeArtist(artist, descriptor.id)),
      getArtistDetail: async (id) => normalizeArtist(await service.getArtistDetail(id), descriptor.id),
      getArtistSongs: async (id) => normalizeTracks(await service.getArtistSongs(id), descriptor.id),
      getArtistAlbums: async (id) => normalizePlaylists(await service.getArtistAlbums(id), descriptor.id),
      getAlbumTracks: async (id) => normalizeTracks(await service.getAlbumTracks(id), descriptor.id),
      getSimilarArtists: service.getSimilarArtists
        ? async (id) => (await service.getSimilarArtists!(id))
            .map((artist) => normalizeArtist(artist, descriptor.id))
        : undefined,
    },
    playback: {
      async getQualities(track) {
        const qualities = await fetchTrackQualities(track)
        return qualities.map((quality, rank) => ({
          id: quality.level,
          label: quality.label,
          rank,
          bitrate: quality.br,
        }))
      },
      async resolve(track, quality, signal) {
        const result = await resolveSongUrl(track, quality, signal)
        if (!result.url) {
          throw new PlaybackUnavailableError(
            result.restriction?.message || result.message || '当前平台没有返回可播放地址',
            result.restriction ? 'restricted' : 'unavailable'
          )
        }
        const candidates = result.candidates?.length
          ? result.candidates
          : [{ url: result.url, quality: result.quality, level: result.level, trial: result.trial }]
        return candidates.map((candidate, rank) => {
          const id = candidate.level ?? result.level ?? quality
          return {
            source: descriptor.id,
            track,
            quality: { id, label: candidate.quality ?? result.quality ?? id, rank },
            url: candidate.url,
            trial: !!candidate.trial,
          }
        })
      },
      getLyrics: (track) => service.getLyrics(track),
    },
    recommendations: recommendationCapability(service, descriptor.id, surfaces),
    library: libraryCapability(service, descriptor.id),
    history: historyCapability(service, descriptor.id),
    playlistWriter: playlistWriterCapability(service, descriptor.id),
    toplists: toplistCapability(service, descriptor.id),
  }
}
