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
import { providerFor } from '../providers/registry'
import { providerAccountSession } from '../lib/provider-account-session'
import type { Track } from '../types/domain'

export interface OfflineSaveJob {
  track: Track
  status: 'queued' | 'resolving' | 'saving' | 'exporting' | 'failed' | 'done'
  controller: AbortController
  directory: string
  filePath?: string
  receivedBytes?: number
  totalBytes?: number
  error?: string
}

interface OfflineCacheStore {
  byKey: Record<string, OfflineCacheStatus>
  revision: number
  jobs: OfflineSaveJob[]
  paused: boolean
  queueOpen: boolean
  downloadDir: string
  directoryError: string
  ensure(track: Track): Promise<OfflineCacheStatus | null>
  ensureMany(tracks: Track[]): Promise<void>
  save(track: Track): Promise<void>
  saveMany(tracks: Track[], signal?: AbortSignal): Promise<number>
  setPaused(paused: boolean): void
  setQueueOpen(open: boolean): void
  loadDownloadDir(): Promise<string>
  setDownloadDir(dir: string): Promise<void>
  setPinned(track: Track, pinned: boolean): Promise<void>
  deleteLocal(track: Track, confirmShared?: boolean): Promise<void>
  cancelSave(key?: string): void
  dismissJob(key?: string): void
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

export const OFFLINE_SAVE_CONCURRENCY = 3
export const OFFLINE_SAVE_HISTORY_LIMIT = 100
const completions = new Map<AbortController, () => void>()
let directoryRequest: Promise<string> | null = null
let directoryVersion = 0
let queueVersion = 0

function isActiveJob(job: OfflineSaveJob): boolean {
  return job.status === 'queued' || job.status === 'resolving' || job.status === 'saving' || job.status === 'exporting'
}

/** 保留有限的完成记录；优先保留失败项，避免后续成功掩盖批量保存中的失败。 */
function recentJobs(jobs: OfflineSaveJob[], limit = OFFLINE_SAVE_HISTORY_LIMIT): OfflineSaveJob[] {
  const failed = jobs.filter((job) => job.status === 'failed').slice(-limit)
  const remaining = limit - failed.length
  const done = remaining > 0 ? jobs.filter((job) => job.status === 'done').slice(-remaining) : []
  return [...jobs.filter(isActiveJob), ...done, ...failed]
}

function updateJob(controller: AbortController, update: Partial<OfflineSaveJob>): void {
  useOfflineCacheStore.setState((state) => {
    const current = state.jobs.find((job) => job.controller === controller)
    if (!current) return state
    const updated = { ...current, ...update }
    const jobs = isActiveJob(updated)
      ? state.jobs.map((job) => job === current ? updated : job)
      : [...state.jobs.filter((job) => job !== current), updated]
    return { jobs: recentJobs(jobs) }
  })
}

function pumpSaves(): void {
  if (useOfflineCacheStore.getState().paused) return
  const jobs = useOfflineCacheStore.getState().jobs
  const running = jobs.filter((job) => isActiveJob(job) && job.status !== 'queued').length
  for (const job of jobs.filter((job) => job.status === 'queued').slice(0, OFFLINE_SAVE_CONCURRENCY - running)) {
    updateJob(job.controller, { status: 'resolving' })
    void performSave(job).finally(() => {
      completions.get(job.controller)?.()
      completions.delete(job.controller)
      pumpSaves()
    })
  }
}

async function performSave(job: OfflineSaveJob): Promise<void> {
  try {
    if (job.track.pending && (job.track.source === 'netease' || job.track.source === 'qq')) {
      const source = job.track.source
      const session = providerAccountSession(source)
      if (!isProviderParticipating(source)) throw new Error('请先登录并启用歌曲来源平台')
      const tracks = await providerFor(source).catalog.getTracksByIds([job.track.id])
      if (job.controller.signal.aborted) return
      if (session !== providerAccountSession(source) || !isProviderParticipating(source)) throw new Error('账号或平台状态已变化，请重试')
      const track = tracks.find((item) => item.source === source && [item.id, item.mid, item.qqId].some((id) => id != null && String(id) === String(job.track.id)))
      if (!track || track.pending || track.playable === false) throw new Error('无法获取可下载的歌曲详情')
      job = { ...job, track }
      updateJob(job.controller, { track })
    }
    const status = await saveAudio(job)
    if (!status?.entryId || job.controller.signal.aborted) return
    updateJob(job.controller, { status: 'exporting' })
    const result = await api.post<{ filePath: string; size: number }>('/api/downloads/export', {
      entryId: status.entryId, origin: offlineOrigin(job.track), dir: job.directory,
    }, undefined, { signal: job.controller.signal, timeoutMs: 30 * 60 * 1000 })
    if (job.controller.signal.aborted) return
    updateJob(job.controller, { status: 'done', filePath: result.filePath, receivedBytes: result.size, totalBytes: result.size })
  } catch (error) {
    if (!job.controller.signal.aborted) updateJob(job.controller, { status: 'failed', error: errorMessage(error) })
  }
}

async function saveAudio({ track, controller }: OfflineSaveJob): Promise<OfflineCacheStatus | null> {
  const get = useOfflineCacheStore.getState
  const set = useOfflineCacheStore.setState
  const isCurrent = () => !controller.signal.aborted && get().jobs.some((job) => job.controller === controller)
  try {
    const existing = await fetchOfflineStatus(track, controller.signal)
    if (!isCurrent()) return null
    set((state) => ({ byKey: mergeStatuses(state.byKey, [existing]) }))
    if (existing.state === 'pinned') {
      return existing
    }
    if (existing.state === 'cached' && existing.entryId) {
      await api.post('/api/audio-cache/pin', {
        entryId: existing.entryId,
        origin: offlineOrigin(track),
        pinned: true,
      }, undefined, { signal: controller.signal })
      const pinned = await fetchOfflineStatus(track, controller.signal)
      if (!isCurrent()) return null
      get().invalidate()
      set((state) => ({
        byKey: mergeStatuses(state.byKey, [pinned]),
      }))
      return pinned
    }
  } catch {
    if (!isCurrent()) return null
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
      updateJob(controller, { status: 'saving', receivedBytes: 0, totalBytes: undefined })
      const progressId = crypto.randomUUID()
      let tracking = true
      const pollProgress = () => {
        void api.get<{ receivedBytes?: number; totalBytes?: number }>('/api/audio-cache/progress', { id: progressId }, { signal: controller.signal })
          .then((progress) => {
            if (tracking && isCurrent() && progress.totalBytes) updateJob(controller, progress)
          }).catch(() => {})
      }
      const progressTimer = setInterval(pollProgress, 750)
      const stopProgress = () => { tracking = false; clearInterval(progressTimer) }
      controller.signal.addEventListener('abort', stopProgress, { once: true })
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
            progressId,
          },
          undefined,
          { signal: controller.signal, timeoutMs: 30 * 60 * 1000 }
        )
        if (!isCurrent()) return null
        get().invalidate()
        set((state) => ({
          byKey: mergeStatuses(state.byKey, [result.status]),
        }))
        return result.status
      } catch (error) {
        if (!isCurrent()) return null
        lastError = error
        updateJob(controller, { status: 'resolving' })
        candidate = await resolver.next(errorMessage(error))
      } finally {
        stopProgress()
        controller.signal.removeEventListener('abort', stopProgress)
      }
    }
    if (!isCurrent()) return null
    throw lastError ?? new Error(resolver.failureMessage || '暂无可保存音源')
  } catch (error) {
    if (!isCurrent()) return null
    updateJob(controller, { status: 'failed', error: errorMessage(error) })
    return null
  }
}

function enqueueSave(track: Track, directory: string): Promise<void> {
  const key = offlineTrackKey(track)
  const state = useOfflineCacheStore.getState()
  if (state.jobs.some((job) => offlineTrackKey(job.track) === key && isActiveJob(job))) return Promise.resolve()
  const controller = new AbortController()
  const completion = new Promise<void>((resolve) => completions.set(controller, resolve))
  useOfflineCacheStore.setState((current) => ({ jobs: [
    ...recentJobs(current.jobs.filter((job) => offlineTrackKey(job.track) !== key)),
    { track, status: 'queued', controller, directory },
  ] }))
  pumpSaves()
  return completion
}

export const useOfflineCacheStore = create<OfflineCacheStore>((set, get) => ({
  byKey: {},
  revision: 0,
  jobs: [],
  paused: false,
  queueOpen: false,
  downloadDir: '',
  directoryError: '',

  setPaused(paused) { set({ paused }); if (!paused) pumpSaves() },
  setQueueOpen(queueOpen) { set({ queueOpen }) },
  loadDownloadDir() {
    if (get().downloadDir) {
      if (get().directoryError) set({ directoryError: '' })
      return Promise.resolve(get().downloadDir)
    }
    if (directoryRequest) return directoryRequest
    const version = directoryVersion
    directoryRequest = api.get<{ dir: string }>('/api/downloads/config').then(({ dir }) => {
      if (version === directoryVersion) set({ downloadDir: dir, directoryError: '' })
      return get().downloadDir || dir
    }).catch((error) => {
      if (version !== directoryVersion && get().downloadDir) return get().downloadDir
      set({ directoryError: '无法读取下载目录，请重试' })
      throw error
    }).finally(() => { directoryRequest = null })
    return directoryRequest
  },
  async setDownloadDir(dir) {
    const config = await api.post<{ dir: string }>('/api/downloads/config', { dir })
    directoryVersion++
    set({ downloadDir: config.dir, directoryError: '' })
  },

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
    if (track.source !== 'netease' && track.source !== 'qq') return Promise.resolve()
    set({ queueOpen: true })
    const version = queueVersion
    try {
      const directory = get().downloadDir || await get().loadDownloadDir()
      if (version !== queueVersion) return
      return await enqueueSave(track, directory)
    } catch {
      useToastStore.getState().show('下载目录不可用，请在下载队列中重新选择')
    }
  },

  async saveMany(tracks, signal) {
    const version = queueVersion
    set({ queueOpen: true })
    const directory = get().downloadDir || await get().loadDownloadDir()
    if (signal?.aborted || version !== queueVersion) throw new DOMException('下载已取消', 'AbortError')
    let added = 0
    for (const track of tracks) {
      if ((track.source !== 'netease' && track.source !== 'qq') || track.playable === false) continue
      if (get().jobs.some((job) => offlineTrackKey(job.track) === offlineTrackKey(track) && isActiveJob(job))) continue
      void enqueueSave(track, directory)
      added++
    }
    set({ queueOpen: true })
    return added
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

  cancelSave(key) {
    if (!key) queueVersion++
    const cancelled = get().jobs.filter((job) => isActiveJob(job) && (!key || offlineTrackKey(job.track) === key))
    set((state) => ({ jobs: state.jobs.filter((job) => !cancelled.includes(job)) }))
    for (const job of cancelled) {
      job.controller.abort()
      completions.get(job.controller)?.()
      completions.delete(job.controller)
    }
    pumpSaves()
  },

  dismissJob(key) {
    set((state) => ({ jobs: state.jobs.filter((job) => isActiveJob(job) || (key && offlineTrackKey(job.track) !== key)) }))
  },

  invalidate() {
    statusRevision++
    set((state) => ({ byKey: {}, revision: state.revision + 1 }))
  },
}))
