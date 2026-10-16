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
  /** 更新现有目标前检查的云端版本，防止覆盖检查后发生的变化。 */
  expectedRevision?: string
}

export type PlaylistSyncTrack = PlaylistSyncInput['tracks'][number]

export interface PlaylistSyncSnapshot {
  name: string
  tracks: PlaylistSyncTrack[]
  revision: string
}

export interface PlaylistSyncReadInput extends PlaylistSyncSession {
  playlistId: string
}

export type PlaylistSyncStep = 'add' | 'remove' | 'name' | 'order' | 'read'

export interface PlaylistSyncReport {
  requested: number
  matched: number | null
  added: number | null
  removed: number | null
  missingIds: string[]
  extraIds: string[]
  name: 'done' | 'pending' | 'unknown'
  order: 'done' | 'pending' | 'unsupported' | 'unknown'
  issues: { step: PlaylistSyncStep; message: string }[]
}

export interface PlaylistSyncResult {
  /** 兼容旧调用方；仅 complete 为 true，界面以 status/report 展示部分结果。 */
  success: boolean
  status: 'complete' | 'partial' | 'failed' | 'stale'
  playlistId?: string
  error?: string
  snapshot?: PlaylistSyncSnapshot
  report?: PlaylistSyncReport
}
