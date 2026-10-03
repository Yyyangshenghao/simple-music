import { isProviderParticipating, useProviderStore, type ProviderRuntimeState } from '../stores/providers'
import { serviceFor } from './service-registry'
import { isProviderId } from '../providers/types'
import type { MusicSource, Track } from '../types/domain'

// 只保留在途详情请求；滚动和点击同一占位曲目时共用结果，完成后释放。
const queueDetailsInFlight = new Map<Track, {
  providerState: ProviderRuntimeState | null
  promise: Promise<Track | undefined>
}>()

export async function fetchQueueDetails(tracks: Track[]): Promise<Map<Track, Track>> {
  const groups = new Map<MusicSource, Track[]>()
  for (const track of tracks) {
    if (isProviderId(track.source) && !isProviderParticipating(track.source)) continue
    const providerState = isProviderId(track.source) ? useProviderStore.getState().byId[track.source] : null
    if (queueDetailsInFlight.get(track)?.providerState === providerState) continue
    const group = groups.get(track.source) ?? []
    group.push(track)
    groups.set(track.source, group)
  }
  for (const [source, group] of groups) {
    const providerState = isProviderId(source) ? useProviderStore.getState().byId[source] : null
    const request = serviceFor(source).getTracksByIds(group.map((track) => track.id))
      .then((fetched) => {
        if (isProviderId(source) && useProviderStore.getState().byId[source] !== providerState) return []
        return fetched.filter((track) => track.source === source && !track.pending)
      })
      .catch(() => [] as Track[])
    for (const track of group) {
      const promise = request.then((fetched) => fetched.find((full) => String(full.id) === String(track.id)))
        .finally(() => {
          if (queueDetailsInFlight.get(track)?.promise === promise) queueDetailsInFlight.delete(track)
        })
      queueDetailsInFlight.set(track, { providerState, promise })
    }
  }
  const resolved = await Promise.all(tracks.map((track) => queueDetailsInFlight.get(track)?.promise))
  return new Map(resolved.flatMap((full, index) => full ? [[tracks[index], full] as const] : []))
}

/** pending 占位曲目:先按 id 补详情;失败则去掉 pending 标记凭 id 兜底直接播(网易播放 URL 只需 id)。 */
export async function resolvePending(track: Track): Promise<Track> {
  if (isProviderId(track.source) && !isProviderParticipating(track.source)) {
    return { ...track, pending: false, name: track.name || '未知曲目' }
  }
  const full = (await fetchQueueDetails([track])).get(track)
  if (full) return full
  return { ...track, pending: false, name: track.name || '未知曲目' }
}
