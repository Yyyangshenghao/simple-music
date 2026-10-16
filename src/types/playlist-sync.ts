import type { MusicSource } from './domain'

export type PlaylistSyncSource = 'netease' | 'qq'

export interface PlaylistSyncSession {
  accountId: string
  accountToken: string
}

export interface PlaylistSyncInput extends PlaylistSyncSession {
  appPlaylistId: string
  name: string
  tracks: { source: MusicSource; id: string; qqId?: string; songType?: number }[]
  playlistId?: string
}

export interface PlaylistSyncResult {
  success: boolean
  playlistId?: string
  error?: string
}
