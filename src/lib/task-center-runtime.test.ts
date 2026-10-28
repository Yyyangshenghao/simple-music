import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useOfflineCacheStore, type OfflineSaveJob } from '../stores/offline-cache'
import { useKaraokeStore } from '../stores/karaoke'
import { useTaskCenterStore, EMPTY_TASK_SUMMARY } from '../stores/task-center'
import { initTaskCenterRuntime } from './task-center-runtime'
import type { Track } from '../types/domain'

const track: Track = { id: 1, source: 'netease', provider: 'netease', type: 'song', name: '歌曲', artist: '艺人', artists: [] }
const download = (status: OfflineSaveJob['status']): OfflineSaveJob => ({ track, status, directory: '/downloads', controller: new AbortController(), receivedBytes: 25, totalBytes: 100 })
let stop: () => void
beforeEach(() => {
  useTaskCenterStore.setState({ open: false, visible: false, pulse: 0, completion: 0, batchResults: [], seenResults: [], summary: EMPTY_TASK_SUMMARY, seenAt: null, lastSettledAt: null })
  useOfflineCacheStore.setState({ jobs: [], paused: false, directoryError: '', recoveryError: '' })
  useKaraokeStore.setState({ jobs: [], recent: [], paused: false, error: '' })
  stop = initTaskCenterRuntime()
})
afterEach(() => { stop(); vi.useRealTimers() })

it('两边同时运行时图标和进度跟随最近启动的任务，阶段变更不改启动顺序', () => {
  useOfflineCacheStore.setState({ jobs: [download('saving')] })
  expect(useTaskCenterStore.getState().summary).toMatchObject({ current: 'download', progress: .25, running: 1 })
  useKaraokeStore.setState({ jobs: [{ id: 'k1', track, model: 'hq3', directory: '/songs', phase: 'separating', progress: .6 }] })
  expect(useTaskCenterStore.getState().summary).toMatchObject({ download: 1, karaoke: 1, current: 'karaoke', progress: .6, running: 2 })
  useOfflineCacheStore.setState({ jobs: [download('exporting')] })
  expect(useTaskCenterStore.getState().summary.current).toBe('karaoke')
  useKaraokeStore.setState({ jobs: [] })
  expect(useTaskCenterStore.getState().summary).toMatchObject({ current: 'download', progress: null })
})
it('伴奏完成后仍默认打开伴奏分区，保留较早下载记录不影响最近活动', () => {
  useOfflineCacheStore.setState({ jobs: [download('done')] })
  useKaraokeStore.setState({ jobs: [{ id: 'k1', track, model: 'hq3', directory: '/songs', phase: 'queued', progress: 0 }] })
  useKaraokeStore.setState({ jobs: [], recent: [{ jobId: 'k1', accompanimentId: 'saved', track, model: 'hq3', at: Date.now() }] })
  useTaskCenterStore.getState().show()
  expect(useTaskCenterStore.getState().tab).toBe('karaoke')
})
it('恢复暂停任务不打开面板，全部暂停显示暂停标记，等待资源不算运行', () => {
  useOfflineCacheStore.setState({ paused: true, jobs: [download('queued')] })
  useKaraokeStore.setState({ paused: true, jobs: [{ id: 'k1', track, model: 'hq3', directory: '/songs', phase: 'waiting-memory', progress: 0 }] })
  expect(useTaskCenterStore.getState()).toMatchObject({ open: false, visible: true })
  expect(useTaskCenterStore.getState().summary).toMatchObject({ allPaused: true, running: 0, progress: null, current: 'karaoke' })
})
it('失败重试产生一次新任务脉冲，进度更新不重复触发', () => {
  useOfflineCacheStore.setState({ jobs: [download('failed')] })
  const before = useTaskCenterStore.getState().pulse
  useOfflineCacheStore.setState({ jobs: [download('queued')] })
  expect(useTaskCenterStore.getState().pulse).toBe(before + 1)
  useOfflineCacheStore.setState({ jobs: [download('saving')] })
  expect(useTaskCenterStore.getState().pulse).toBe(before + 1)
})

it('同一批快照内两队列均已启动时，按后台时间选择，不能被遍历顺序覆盖', () => {
  stop()
  useOfflineCacheStore.setState({ jobs: [{ ...download('saving'), addedAt: 1000, startedAt: 3000 }] })
  useKaraokeStore.setState({ jobs: [{ id: 'k1', track, model: 'hq3', directory: '/songs', phase: 'separating', progress: .6, addedAt: 1000, startedAt: 2000 }] })
  stop = initTaskCenterRuntime()
  expect(useTaskCenterStore.getState().summary).toMatchObject({ current: 'download', progress: .25 })
})
