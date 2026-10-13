import { useOfflineCacheStore, type OfflineSaveJob } from '../stores/offline-cache'
import { offlineTrackKey } from './offline-cache'
import type { Track } from '../types/domain'

export const DOWNLOAD_QUEUE_STORAGE_KEY = 'simplemusic-download-queue'
const SCHEMA = 1

function unfinished(job: OfflineSaveJob): boolean {
  return job.status !== 'done' && job.status !== 'failed'
}

function stripUrl(track: Track): Track {
  const { url: _url, ...rest } = track
  return rest
}

function restoreJobs(): OfflineSaveJob[] | null {
  let raw: string | null
  try {
    raw = localStorage.getItem(DOWNLOAD_QUEUE_STORAGE_KEY)
  } catch {
    useOfflineCacheStore.setState({ recoveryError: '无法读取未完成下载，本次新任务暂不保存；请重启后重试', queueOpen: true })
    return null
  }
  if (!raw) return []
  try {
    const data = JSON.parse(raw)
    if (data?.schema !== SCHEMA || !Array.isArray(data.jobs)) throw new Error('无效的下载记录')
    const found = new Set<string>()
    return data.jobs.flatMap((job: { track?: Track; directory?: string } | null) => {
      const track = job?.track
      if (!track || (track.source !== 'netease' && track.source !== 'qq') || track.provider !== track.source
        || (typeof track.id !== 'string' && typeof track.id !== 'number') || !String(track.id)
        || typeof track.type !== 'string' || typeof track.name !== 'string' || typeof track.artist !== 'string'
        || !Array.isArray(track.artists) || typeof job?.directory !== 'string' || !job.directory.trim()) return []
      const key = offlineTrackKey(track)
      if (found.has(key)) return []
      found.add(key)
      return [{ track: stripUrl(track), directory: job.directory, status: 'queued', controller: new AbortController() }]
    })
  } catch {
    useOfflineCacheStore.setState({ recoveryError: '未完成下载记录格式无法恢复，之前的任务需重新添加', queueOpen: true })
    return []
  }
}

let stopRuntime: (() => void) | undefined

/** 界面卸载不停止任务；冷启动恢复为暂停态，宿主退出保存后中止未完成请求。 */
export function initDownloadQueueRuntime(): () => void {
  if (stopRuntime) return stopRuntime
  const store = useOfflineCacheStore
  const jobs = store.getState().jobs.length ? [] : restoreJobs()
  let unreadable = jobs === null
  if (jobs?.length) store.setState({ jobs, paused: true, queueOpen: true })
  let serialized: string | undefined
  let dirty = false
  function save(): void {
    dirty = true
    if (unreadable) {
      // 未读到的旧队列不能被新任务覆盖；仅确认没有旧存档时才解除保护。
      try {
        if (localStorage.getItem(DOWNLOAD_QUEUE_STORAGE_KEY) !== null) return
        unreadable = false
      } catch { return }
    }
    try {
      const jobs = store.getState().jobs.filter(unfinished).map(job => ({ track: stripUrl(job.track), directory: job.directory }))
      const next = JSON.stringify({ schema: SCHEMA, jobs })
      if (next !== serialized) localStorage.setItem(DOWNLOAD_QUEUE_STORAGE_KEY, next)
      serialized = next
      dirty = false
      if (store.getState().recoveryError) store.setState({ recoveryError: '' })
    } catch {
      store.setState({ recoveryError: '无法保存未完成下载，退出应用后可能需要重新添加' })
    }
  }
  const unsubscribe = store.subscribe((state, previous) => {
    if (state.jobs !== previous.jobs) save()
  })
  let stopped = false
  stopRuntime = () => {
    if (stopped) return
    stopped = true
    store.getState().setPaused(true)
    // 先解绑再取消：主动取消清除存档，退出取消则保留待恢复任务。
    unsubscribe()
    if (dirty || store.getState().jobs.some(unfinished)) save()
    store.getState().cancelSave()
  }
  return stopRuntime
}
