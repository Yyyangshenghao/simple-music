import { create } from 'zustand'
import { PlaybackResolver } from '../lib/playback-resolver'
import { audioDiskCacheKey } from '../lib/track-preload'
import {
  fetchOfflineStatus,
  fetchOfflineStatuses,
  offlineOrigin,
  offlineTrackKey,
  type OfflineCacheStatus,
} from '../lib/offline-cache'
import { api } from '../lib/api'
import { isProviderParticipating, useProviderStore } from './providers'
import { useSettingsStore } from './settings'
import { useToastStore } from './toast'
import type { Track } from '../types/domain'

export interface OfflineSaveJob {
  track: Track
  status: 'resolving' | 'saving' | 'failed' | 'done'
  controller: AbortController
  error?: string
}

interface OfflineCacheStore {
  byKey: Record<string, OfflineCacheStatus>
  revision: number
  job: OfflineSaveJob | null
  ensure(track: Track): Promise<OfflineCacheStatus | null>
  ensureMany(tracks: Track[]): Promise<void>
  save(track: Track): Promise<void>
  setPinned(track: Track, pinned: boolean): Promise<void>
  deleteLocal(track: Track, confirmShared?: boolean): Promise<void>
  cancelSave(): void
  dismissJob(): void
  invalidate(): void
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

interface StatusWaiter {
  track: Track
  resolve: (status: OfflineCacheStatus | null) => void
}

const pendingStatuses = new Map<string, StatusWaiter[]>()
let statusBatchTimer: ReturnType<typeof setTimeout> | null = null
let statusRevision = 0
const MAX_CACHED_STATUSES = 2048

function mergeStatuses(current: Record<string, OfflineCacheStatus>, statuses: OfflineCacheStatus[]): Record<string, OfflineCacheStatus> {
  const next = { ...current }
  for (const status of statuses) {
    const key = `${status.source}:${status.id}`
    delete next[key]
    next[key] = status
  }
  const keys = Object.keys(next)
  for (let i = 0; i < keys.length - MAX_CACHED_STATUSES; i++) delete next[keys[i]]
  return next
}

function scheduleStatusBatch(): void {
  if (statusBatchTimer) return
  statusBatchTimer = setTimeout(() => {
    statusBatchTimer = null
    const revision = statusRevision
    const batch = [...pendingStatuses.entries()].slice(0, 100)
    for (const [pendingKey] of batch) pendingStatuses.delete(pendingKey)
    const tracks = batch.map(([, waiters]) => waiters[0].track)
    void fetchOfflineStatuses(tracks)
      .then((statuses) => {
        const found = new Map(statuses.map((status) => [`${status.source}:${status.id}`, status]))
        if (revision === statusRevision) {
          useOfflineCacheStore.setState((state) => ({
            byKey: mergeStatuses(state.byKey, statuses),
          }))
        }
        for (const [pendingKey, waiters] of batch) {
          const status = revision === statusRevision ? found.get(pendingKey) ?? null : null
          for (const waiter of waiters) waiter.resolve(status)
        }
      })
      .catch(() => {
        for (const [, waiters] of batch) for (const waiter of waiters) waiter.resolve(null)
      })
    if (pendingStatuses.size) scheduleStatusBatch()
  }, 0)
}

function queueStatus(track: Track): Promise<OfflineCacheStatus | null> {
  const key = offlineTrackKey(track)
  return new Promise((resolve) => {
    pendingStatuses.set(key, [...(pendingStatuses.get(key) ?? []), { track, resolve }])
    scheduleStatusBatch()
  })
}

export const useOfflineCacheStore = create<OfflineCacheStore>((set, get) => ({
  byKey: {},
  revision: 0,
  job: null,

  async ensure(track) {
    if (track.source !== 'netease' && track.source !== 'qq') return null
    const key = offlineTrackKey(track)
    const known = get().byKey[key]
    if (known) return known
    return queueStatus(track)
  },

  async ensureMany(tracks) {
    const pending = tracks.filter((track) => (
      (track.source === 'netease' || track.source === 'qq') && !get().byKey[offlineTrackKey(track)]
    ))
    if (!pending.length) return
    const revision = statusRevision
    try {
      const statuses = await fetchOfflineStatuses(pending)
      if (revision !== statusRevision) return
      set((state) => ({
        byKey: mergeStatuses(state.byKey, statuses),
      }))
    } catch {
      /* 状态徽标失败不阻断列表。 */
    }
  },

  async save(track) {
    if (track.source !== 'netease' && track.source !== 'qq') return
    if (get().job && get().job?.status !== 'done' && get().job?.status !== 'failed') {
      useToastStore.getState().show('已有歌曲正在保存')
      return
    }
    const controller = new AbortController()
    set({ job: { track, status: 'resolving', controller } })
    const isCurrent = () => !controller.signal.aborted && get().job?.controller === controller
    try {
      const existing = await fetchOfflineStatus(track, controller.signal)
      if (!isCurrent()) return
      set((state) => ({ byKey: mergeStatuses(state.byKey, [existing]) }))
      if (existing.state === 'pinned') {
        set({ job: { track, status: 'done', controller } })
        return
      }
      if (existing.state === 'cached' && existing.entryId) {
        await api.post('/api/audio-cache/pin', {
          entryId: existing.entryId,
          origin: offlineOrigin(track),
          pinned: true,
        }, undefined, { signal: controller.signal })
        const pinned = await fetchOfflineStatus(track, controller.signal)
        if (!isCurrent()) return
        get().invalidate()
        set((state) => ({
          byKey: mergeStatuses(state.byKey, [pinned]),
          job: { track, status: 'done', controller },
        }))
        useToastStore.getState().show('已保存到本地')
        return
      }
    } catch {
      if (!isCurrent()) return
      // 状态回查失败不阻断主动保存，后续解析仍可独立完成。
    }
    const providerState = useProviderStore.getState()
    const resolver = new PlaybackResolver(
      track,
      useSettingsStore.getState().audioQuality,
      {
        playbackOrder: providerState.playbackOrder.filter(isProviderParticipating),
        preferOriginSource: providerState.preferOriginSource,
        multiSourceFallback: providerState.multiSourceFallback,
      },
      { isParticipating: isProviderParticipating }
    )
    controller.signal.addEventListener('abort', () => resolver.abort(), { once: true })
    try {
      let candidate = await resolver.next()
      let lastError: unknown
      while (candidate && isCurrent()) {
        if (candidate.trial) {
          candidate = await resolver.next('TRIAL_NOT_SAVABLE')
          continue
        }
        set({ job: { track, status: 'saving', controller } })
        try {
          const resolvedId = String(candidate.track.mid ?? candidate.track.id)
          const result = await api.post<{ ok: true; status: OfflineCacheStatus }>(
            '/api/audio-cache/save',
            {
              url: candidate.url,
              cacheKey: audioDiskCacheKey(candidate.track, candidate.quality.id),
              origin: offlineOrigin(track),
              resolved: { ...offlineOrigin(candidate.track), id: resolvedId },
              quality: candidate.quality.id,
              trial: candidate.trial,
            },
            undefined,
            { signal: controller.signal, timeoutMs: 30 * 60 * 1000 }
          )
          if (!isCurrent()) return
          get().invalidate()
          set((state) => ({
            byKey: mergeStatuses(state.byKey, [result.status]),
            job: { track, status: 'done', controller },
          }))
          useToastStore.getState().show('已保存到本地')
          return
        } catch (error) {
          if (!isCurrent()) return
          lastError = error
          set({ job: { track, status: 'resolving', controller } })
          candidate = await resolver.next(errorMessage(error))
        }
      }
      if (!isCurrent()) return
      throw lastError ?? new Error(resolver.failureMessage || '暂无可保存音源')
    } catch (error) {
      if (!isCurrent()) return
      set({ job: { track, status: 'failed', controller, error: errorMessage(error) } })
      useToastStore.getState().show('保存失败，请稍后重试')
    }
  },

  async setPinned(track, pinned) {
    const key = offlineTrackKey(track)
    const status = get().byKey[key] ?? await get().ensure(track)
    if (!status?.entryId) return
    await api.post('/api/audio-cache/pin', {
      entryId: status.entryId,
      origin: offlineOrigin(track),
      pinned,
    })
    const next = await fetchOfflineStatus(track)
    get().invalidate()
    set((state) => ({ byKey: mergeStatuses(state.byKey, [next]) }))
  },

  async deleteLocal(track, confirmShared = false) {
    const key = offlineTrackKey(track)
    const status = get().byKey[key] ?? await get().ensure(track)
    if (!status?.entryId) return
    await api.post('/api/audio-cache/delete', {
      entryId: status.entryId,
      origin: offlineOrigin(track),
      confirmShared,
    })
    get().invalidate()
    useToastStore.getState().show('本地文件已删除')
  },

  cancelSave() {
    const job = get().job
    if (!job || job.status === 'done' || job.status === 'failed') return
    set({ job: null })
    job.controller.abort()
  },

  dismissJob() {
    const job = get().job
    if (!job || job.status === 'done' || job.status === 'failed') set({ job: null })
  },

  invalidate() {
    statusRevision++
    set((state) => ({ byKey: {}, revision: state.revision + 1 }))
  },
}))
