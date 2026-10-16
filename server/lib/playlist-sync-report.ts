import { createHash } from 'node:crypto'
import type { PlaylistSyncReport, PlaylistSyncResult, PlaylistSyncSnapshot, PlaylistSyncTrack } from '../../src/types/playlist-sync'

const keyOf = (track: PlaylistSyncTrack) => `${track.source}:${track.id}`

export function playlistSyncSnapshot(name: string, tracks: PlaylistSyncTrack[]): PlaylistSyncSnapshot {
  const revision = createHash('sha256').update(JSON.stringify([name, tracks.map(track => [track.source, track.id, track.qqId, track.songType])])).digest('hex')
  return { name, tracks, revision }
}

export function playlistSyncResult(
  playlistId: string,
  desired: Pick<PlaylistSyncSnapshot, 'name' | 'tracks'>,
  initial: PlaylistSyncSnapshot,
  verified: PlaylistSyncSnapshot | undefined,
  issues: PlaylistSyncReport['issues'],
  supportsOrder: boolean,
): PlaylistSyncResult {
  const wanted = new Set(desired.tracks.map(keyOf))
  const before = new Set(initial.tracks.map(keyOf))
  const actual = verified ? new Set(verified.tracks.map(keyOf)) : null
  const missingIds = actual ? desired.tracks.filter(track => !actual.has(keyOf(track))).map(track => track.id) : []
  const extraIds = verified ? verified.tracks.filter(track => !wanted.has(keyOf(track))).map(track => track.id) : []
  const expectedOrder = verified ? [
    ...desired.tracks.filter(track => actual!.has(keyOf(track))).map(keyOf),
    ...verified.tracks.filter(track => !wanted.has(keyOf(track))).map(keyOf),
  ] : []
  const name = !verified ? 'unknown' : verified.name === desired.name ? 'done' : 'pending'
  const order = !supportsOrder ? 'unsupported' : !verified ? 'unknown'
    : JSON.stringify(verified.tracks.map(keyOf)) === JSON.stringify(expectedOrder) ? 'done' : 'pending'
  const complete = !!verified && !missingIds.length && !extraIds.length && name === 'done' && (order === 'done' || order === 'unsupported')
  const unfinished = issues.filter(issue => !complete && (issue.step === 'read'
    || issue.step === 'add' && (!verified || missingIds.length > 0)
    || issue.step === 'remove' && (!verified || extraIds.length > 0)
    || issue.step === 'name' && name !== 'done'
    || issue.step === 'order' && order !== 'done' && order !== 'unsupported'))
  return {
    status: complete ? 'complete' : 'partial', success: complete, playlistId, snapshot: verified,
    report: {
      requested: desired.tracks.length,
      matched: actual ? desired.tracks.length - missingIds.length : null,
      added: verified ? verified.tracks.filter(track => !before.has(keyOf(track))).length : null,
      removed: actual ? initial.tracks.filter(track => !actual.has(keyOf(track))).length : null,
      missingIds, extraIds, name, order,
      issues: unfinished.filter((issue, index, all) => all.findIndex(other => other.step === issue.step && other.message === issue.message) === index).slice(0, 32),
    },
  }
}
