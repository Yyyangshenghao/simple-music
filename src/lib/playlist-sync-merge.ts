import type { PlaylistSyncSnapshot, PlaylistSyncTrack } from '../types/playlist-sync'

type PlaylistSyncContent = Pick<PlaylistSyncSnapshot, 'name' | 'tracks'>
type PlaylistSyncChoice = 'local' | 'cloud'

export interface PlaylistSyncChanges {
  added: string[]
  removed: string[]
  renamed: boolean
  reordered: boolean
}

interface PlaylistSyncConflict {
  id: string
  kind: 'name' | 'order' | 'delete'
  trackId?: string
}

interface TrackIndex {
  keys: string[]
  tracks: Map<string, PlaylistSyncTrack>
}

function indexTracks(tracks: PlaylistSyncTrack[]): TrackIndex {
  const byKey = new Map<string, PlaylistSyncTrack>()
  for (const track of tracks) {
    const key = `${track.source}:${String(track.id)}`
    if (!byKey.has(key)) byKey.set(key, track)
  }
  return { keys: [...byKey.keys()], tracks: byKey }
}

function sameOrder(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((key, index) => key === right[index])
}

function changesBetween(base: PlaylistSyncContent, next: PlaylistSyncContent, baseIndex: TrackIndex, nextIndex: TrackIndex, includeOrder: boolean): PlaylistSyncChanges {
  const added = nextIndex.keys.filter(key => !baseIndex.tracks.has(key))
  const removed = baseIndex.keys.filter(key => !nextIndex.tracks.has(key))
  return {
    added: added.map(key => String(nextIndex.tracks.get(key)!.id)),
    removed: removed.map(key => String(baseIndex.tracks.get(key)!.id)),
    renamed: base.name !== next.name,
    reordered: includeOrder && !sameOrder(
      baseIndex.keys.filter(key => nextIndex.tracks.has(key)),
      nextIndex.keys.filter(key => baseIndex.tracks.has(key))
    )
  }
}

export function playlistSyncChanges(base: PlaylistSyncContent, next: PlaylistSyncContent, includeOrder = true): PlaylistSyncChanges {
  return changesBetween(base, next, indexTracks(base.tracks), indexTracks(next.tracks), includeOrder)
}

/** 仅标记参与基准歌曲相对顺序逆序的歌曲，插入、删除其他歌曲不算移动。 */
function movedBaseKeys(base: TrackIndex, next: TrackIndex): Set<string> {
  const ranks = new Map(base.keys.map((key, index) => [key, index]))
  const keys = next.keys.filter(key => ranks.has(key))
  const moved = new Set<string>()
  let prefixMax = -1
  for (const key of keys) {
    const rank = ranks.get(key)!
    if (rank < prefixMax) moved.add(key)
    prefixMax = Math.max(prefixMax, rank)
  }
  let suffixMin = base.keys.length
  for (let index = keys.length - 1; index >= 0; index--) {
    const key = keys[index]
    const rank = ranks.get(key)!
    if (rank > suffixMin) moved.add(key)
    suffixMin = Math.min(suffixMin, rank)
  }
  return moved
}

/** 另一边独有歌曲插到其下一个主序列锚点前；同位新增先保留主序列歌曲。 */
function mergeOrder(primary: string[], secondary: string[], retained: Set<string>): string[] {
  const main = primary.filter(key => retained.has(key))
  const mainSet = new Set(main)
  const before = new Map<string, string[]>()
  let pending: string[] = []
  for (const key of secondary) {
    if (!retained.has(key)) continue
    if (mainSet.has(key)) {
      if (pending.length) before.set(key, pending)
      pending = []
    } else {
      pending.push(key)
    }
  }
  const merged: string[] = []
  for (const key of main) {
    for (const extra of before.get(key) ?? []) merged.push(extra)
    merged.push(key)
  }
  for (const key of pending) merged.push(key)
  return merged
}

export function planPlaylistSyncMerge(
  base: PlaylistSyncContent,
  local: PlaylistSyncContent,
  cloud: PlaylistSyncContent,
  includeLocalOrder = true,
  choices: Record<string, PlaylistSyncChoice> = {}
): {
  content: PlaylistSyncContent
  localChanges: PlaylistSyncChanges
  cloudChanges: PlaylistSyncChanges
  conflicts: PlaylistSyncConflict[]
} {
  const baseIndex = indexTracks(base.tracks)
  const localIndex = indexTracks(local.tracks)
  const cloudIndex = indexTracks(cloud.tracks)
  const localChanges = changesBetween(base, local, baseIndex, localIndex, includeLocalOrder)
  const cloudChanges = changesBetween(base, cloud, baseIndex, cloudIndex, true)
  const conflicts: PlaylistSyncConflict[] = []
  let name = localChanges.renamed ? local.name : cloud.name
  if (localChanges.renamed && cloudChanges.renamed && local.name !== cloud.name) {
    conflicts.push({ id: 'name', kind: 'name' })
    name = choices.name === 'cloud' ? cloud.name : local.name
  }

  const movedLocal = includeLocalOrder ? movedBaseKeys(baseIndex, localIndex) : new Set<string>()
  const movedCloud = movedBaseKeys(baseIndex, cloudIndex)
  const retained = new Set<string>()
  for (const key of baseIndex.keys) {
    const inLocal = localIndex.tracks.has(key)
    const inCloud = cloudIndex.tracks.has(key)
    if ((!inLocal && inCloud && movedCloud.has(key)) || (!inCloud && inLocal && movedLocal.has(key))) {
      const id = `delete:${key}`
      conflicts.push({ id, kind: 'delete', trackId: String(baseIndex.tracks.get(key)!.id) })
      if (choices[id] === 'cloud' ? inCloud : inLocal) retained.add(key)
    } else if (inLocal && inCloud) {
      retained.add(key)
    }
  }
  for (const key of [...localIndex.keys, ...cloudIndex.keys]) {
    if (!baseIndex.tracks.has(key)) retained.add(key)
  }

  const commonBase = baseIndex.keys.filter(key => localIndex.tracks.has(key) && cloudIndex.tracks.has(key))
  const commonSet = new Set(commonBase)
  const localOrder = localIndex.keys.filter(key => commonSet.has(key))
  const cloudOrder = cloudIndex.keys.filter(key => commonSet.has(key))
  const localReordered = includeLocalOrder && !sameOrder(commonBase, localOrder)
  const cloudReordered = !sameOrder(commonBase, cloudOrder)
  let primary: PlaylistSyncChoice = !includeLocalOrder || (!localReordered && cloudReordered) ? 'cloud' : 'local'
  if (localReordered && cloudReordered && !sameOrder(localOrder, cloudOrder)) {
    conflicts.push({ id: 'order', kind: 'order' })
    primary = choices.order === 'cloud' ? 'cloud' : 'local'
  }
  const mergedKeys = primary === 'local'
    ? mergeOrder(localIndex.keys, cloudIndex.keys, retained)
    : mergeOrder(cloudIndex.keys, localIndex.keys, retained)
  const tracks = mergedKeys.map(key => ({ ...(cloudIndex.tracks.get(key) ?? localIndex.tracks.get(key))! }))
  return { content: { name, tracks }, localChanges, cloudChanges, conflicts }
}
