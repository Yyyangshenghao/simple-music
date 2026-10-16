import type { PlaylistSyncReport, PlaylistSyncSnapshot, PlaylistSyncSource } from '../types/playlist-sync'

export function isPlaylistSyncReport(value: unknown): value is PlaylistSyncReport {
  if (!value || typeof value !== 'object') return false
  const report = value as PlaylistSyncReport
  const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 10000
  return count(report.requested) && [report.matched, report.added, report.removed].every(value => value === null || count(value))
    && [report.missingIds, report.extraIds].every(ids => Array.isArray(ids) && ids.length <= 10000 && ids.every(id => typeof id === 'string'))
    && ['done', 'pending', 'unknown'].includes(report.name)
    && ['done', 'pending', 'unsupported', 'unknown'].includes(report.order)
    && Array.isArray(report.issues) && report.issues.length <= 32 && report.issues.every(issue => issue
      && ['add', 'remove', 'name', 'order', 'read'].includes(issue.step) && typeof issue.message === 'string')
}

export function isPlaylistSyncSnapshot(value: unknown, source: PlaylistSyncSource): value is PlaylistSyncSnapshot {
  if (!value || typeof value !== 'object') return false
  const snapshot = value as PlaylistSyncSnapshot
  if (typeof snapshot.name !== 'string' || !snapshot.name.trim() || snapshot.name.length > 80
    || typeof snapshot.revision !== 'string' || !/^[a-f0-9]{64}$/.test(snapshot.revision)
    || !Array.isArray(snapshot.tracks) || snapshot.tracks.length > 10000) return false
  const keys = new Set<string>()
  return snapshot.tracks.every(track => {
    if (!track || track.source !== source || typeof track.id !== 'string'
      || !(source === 'netease' ? /^[1-9]\d*$/ : /^[a-zA-Z0-9]{1,64}$/).test(track.id)
      || keys.has(track.id)) return false
    keys.add(track.id)
    return source !== 'qq' || typeof track.qqId === 'string' && /^[1-9]\d*$/.test(track.qqId)
      && Number.isSafeInteger(Number(track.qqId)) && typeof track.songType === 'number'
      && Number.isSafeInteger(track.songType) && track.songType >= 0
  })
}
