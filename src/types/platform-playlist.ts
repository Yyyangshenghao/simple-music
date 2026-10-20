import type { MusicSource } from './domain'

export type WritablePlaylistSource = 'netease' | 'qq'

export interface PlaylistManagementSession {
  accountId: string
  accountToken: string
}

export interface PlatformPlaylistRef extends PlaylistManagementSession {
  playlistId: string
}

export interface PlatformPlaylistTrack {
  source: MusicSource
  id: string
  qqId?: string
  songType?: number
}

export type PlatformPlaylistCommand = (
  | { action: 'create'; name: string; requestId: string }
  | { action: 'rename'; playlistId: string; name: string }
  | { action: 'add' | 'remove'; playlistId: string; tracks: PlatformPlaylistTrack[] }
)

export type PlatformPlaylistMutation = PlaylistManagementSession & PlatformPlaylistCommand

/** 收藏他人歌单或专辑；id 为平台原始 id（QQ 专辑为 albumMid）。 */
export interface CollectionSubscription extends PlaylistManagementSession {
  kind: 'playlist' | 'album'
  id: string
  subscribe: boolean
}

export interface PlatformPlaylistInspection {
  playlistId: string
  name: string
}

export interface PlatformPlaylistMutationResult {
  playlistId: string
  status: 'complete' | 'partial' | 'unknown'
  requested: number
  completed: number | null
  error?: string
}
