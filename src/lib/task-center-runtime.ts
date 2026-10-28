import { useOfflineCacheStore } from '../stores/offline-cache'
import { useKaraokeStore } from '../stores/karaoke'
import { useTaskCenterStore, type TaskTab } from '../stores/task-center'
import { offlineTrackKey } from './offline-cache'

let stopRuntime: (() => void) | undefined

/** 观察后台投影，不能从引擎回调直接改变主窗口的 UI 状态。 */
export function initTaskCenterRuntime(): () => void {
  if (stopRuntime) return stopRuntime
  let sequence = 0
  let latestTab = useTaskCenterStore.getState().summary.latest
  let recentIds = new Set<string>()
  const activity = new Map<string, { phase: string; added: number; started: number; tab: TaskTab }>()
  function update() {
    const downloads = useOfflineCacheStore.getState()
    const karaoke = useKaraokeStore.getState()
    const entries = [
      ...downloads.jobs.map(job => ({ id: `d:${offlineTrackKey(job.track)}`, phase: job.status, addedAt: job.addedAt, startedAt: job.startedAt, tab: 'download' as const,
        queued: job.status === 'queued', failed: job.status === 'failed', done: job.status === 'done',
        progress: job.status === 'saving' && job.totalBytes ? (job.receivedBytes ?? 0) / job.totalBytes : null })),
      ...karaoke.jobs.map(job => ({ id: `k:${job.id}`, phase: job.phase, addedAt: job.addedAt, startedAt: job.startedAt, tab: 'karaoke' as const,
        queued: job.phase === 'queued' || job.phase === 'waiting-memory', failed: job.phase === 'failed', done: false,
        progress: ['model', 'separating'].includes(job.phase) ? job.progress : null })),
    ]
    let added = false
    for (const entry of entries) {
      const previous = activity.get(entry.id)
      const running = !entry.queued && !entry.failed && !entry.done
      const retry = previous?.phase === 'failed' && !entry.failed
      if ((!previous || retry) && !entry.done) added = true
      if (!previous || previous.phase !== entry.phase) latestTab = entry.tab
      activity.set(entry.id, {
        phase: entry.phase, tab: entry.tab, added: Number.isFinite(entry.addedAt) ? entry.addedAt! : !previous || retry ? ++sequence : previous.added,
        started: Number.isFinite(entry.startedAt) ? entry.startedAt! : running && (!previous || ['queued', 'waiting-memory', 'failed'].includes(previous.phase)) ? ++sequence : previous?.started ?? 0,
      })
    }
    const ids = new Set(entries.map(entry => entry.id))
    for (const id of activity.keys()) if (!ids.has(id)) activity.delete(id)
    const pending = entries.filter(entry => !entry.done && !entry.failed)
    const running = pending.filter(entry => !entry.queued)
    if (karaoke.recent.some(item => !recentIds.has(item.jobId))) latestTab = 'karaoke'
    recentIds = new Set(karaoke.recent.map(item => item.jobId))
    const current = [...running].sort((a, b) => activity.get(b.id)!.started - activity.get(a.id)!.started)[0]
      ?? [...pending].sort((a, b) => activity.get(b.id)!.added - activity.get(a.id)!.added)[0]
    useTaskCenterStore.getState().update({
      download: pending.filter(entry => entry.tab === 'download').length,
      karaoke: pending.filter(entry => entry.tab === 'karaoke').length,
      failed: entries.filter(entry => entry.failed).length,
      running: running.length,
      allPaused: pending.length > 0 && !running.length && pending.every(entry => entry.tab === 'download' ? downloads.paused : karaoke.paused),
      current: current?.tab ?? latestTab,
      currentKey: current ? `${current.id}:${current.phase}` : '',
      latest: latestTab,
      progress: current && !current.queued ? current.progress === null ? null : Math.max(0, Math.min(1, current.progress)) : null,
      results: [...entries.filter(entry => entry.done).map(entry => entry.id), ...karaoke.recent.map(item => `k:${item.jobId}`)],
      issue: !!downloads.recoveryError || !!downloads.directoryError || !!karaoke.error,
    }, added)
  }
  update()
  const offDownload = useOfflineCacheStore.subscribe(update)
  const offKaraoke = useKaraokeStore.subscribe(update)
  stopRuntime = () => {
    offDownload(); offKaraoke()
    useTaskCenterStore.getState().dispose()
    stopRuntime = undefined
  }
  return stopRuntime
}
