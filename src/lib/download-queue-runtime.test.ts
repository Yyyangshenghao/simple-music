import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Track } from '../types/domain'

const h = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), status: vi.fn(), next: vi.fn(), abort: vi.fn() }))
vi.mock('./api', () => ({ api: { get: h.get, post: h.post } }))
vi.mock('./offline-cache', async original => ({
  ...await original<typeof import('./offline-cache')>(), fetchOfflineStatus: h.status
}))
vi.mock('./playback-resolver', () => ({ PlaybackResolver: vi.fn(function () {
  return { next: h.next, abort: h.abort }
}) }))
vi.mock('../stores/providers', () => ({
  isProviderParticipating: () => true,
  useProviderStore: { getState: () => ({ playbackOrder: ['netease', 'qq'], preferOriginSource: true, multiSourceFallback: true }) }
}))
vi.mock('../stores/settings', () => ({ useSettingsStore: { getState: () => ({ audioQuality: 'standard' }) } }))

const track: Track = { source: 'qq', provider: 'qq', type: 'song', id: '1', name: '待下载歌曲', artist: '歌手', artists: [], mid: 'mid1', url: 'https://expired.example/audio' }
const key = 'simplemusic-download-queue'
let data: Map<string, string>
let storage: { getItem: ReturnType<typeof vi.fn>; setItem: ReturnType<typeof vi.fn> }
let stop: (() => void) | undefined
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
async function start() {
  const { useOfflineCacheStore: store } = await import('../stores/offline-cache')
  const { initDownloadQueueRuntime } = await import('./download-queue-runtime')
  stop = initDownloadQueueRuntime()
  return { store, initDownloadQueueRuntime }
}
beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  data = new Map()
  storage = {
    getItem: vi.fn((name: string) => data.get(name) ?? null),
    setItem: vi.fn((name: string, value: string) => { data.set(name, value) })
  }
  vi.stubGlobal('localStorage', storage)
  h.get.mockReset().mockResolvedValue({ dir: '/new-downloads' })
  h.post.mockReset().mockResolvedValue({ filePath: '/old-downloads/song.mp3', size: 100 })
  h.status.mockReset().mockImplementation(async (item: Track) => ({ source: item.source, id: String(item.id), state: 'pinned', entryId: `entry-${item.id}` }))
  h.next.mockReset().mockResolvedValue(null)
})
afterEach(() => { stop?.(); stop = undefined; vi.unstubAllGlobals() })

it('退出保留未完成任务和各自目录，取消请求并隔离迟到完成结果', async () => {
  const { store, initDownloadQueueRuntime } = await start()
  store.setState({ downloadDir: '/old-downloads' })
  const old = deferred<{ filePath: string; size: number }>()
  h.post.mockReturnValueOnce(old.promise)
  const saving = store.getState().save(track)
  await vi.waitFor(() => expect(store.getState().jobs[0].status).toBe('exporting'))
  store.getState().setPaused(true)
  store.setState({ downloadDir: '/other-downloads' })
  await store.getState().saveMany([{ ...track, source: 'netease', provider: 'netease' }])
  expect(initDownloadQueueRuntime()).toBe(stop)
  stop!()
  await saving
  const saved = JSON.parse(data.get(key)!)
  expect(saved.jobs.map((job: { directory: string }) => job.directory)).toEqual(['/old-downloads', '/other-downloads'])
  expect(saved.jobs[0].track).toMatchObject({ id: '1', mid: 'mid1' })
  expect(saved.jobs[0].track).not.toHaveProperty('url')
  expect(h.post.mock.calls[0][3].signal.aborted).toBe(true)
  expect(store.getState().jobs).toEqual([])
  const writes = storage.setItem.mock.calls.length
  old.resolve({ filePath: '/old-downloads/late.mp3', size: 1 })
  await Promise.resolve()
  await Promise.resolve()
  expect(store.getState().jobs).toEqual([])
  expect(storage.setItem).toHaveBeenCalledTimes(writes)
  expect(data.get(key)).toBe(JSON.stringify(saved))
})

it('冷启动恢复为暂停队列，手动继续保留三首并发和原目录，缓存完整时不重新解析', async () => {
  data.set(key, JSON.stringify({ schema: 1, jobs: Array.from({ length: 5 }, (_, id) => ({ track: { ...track, id }, directory: '/old-downloads' })) }))
  const { store } = await start()
  expect(store.getState()).toMatchObject({ paused: true })
  expect(store.getState().jobs.map(job => job.status)).toEqual(Array(5).fill('queued'))
  expect(h.get).not.toHaveBeenCalled()
  expect(h.status).not.toHaveBeenCalled()
  const exports = Array.from({ length: 5 }, () => deferred<{ filePath: string; size: number }>())
  exports.forEach(item => h.post.mockReturnValueOnce(item.promise))
  store.getState().setPaused(false)
  await vi.waitFor(() => expect(h.post).toHaveBeenCalledTimes(3))
  expect(h.post.mock.calls.every(call => call[1].dir === '/old-downloads')).toBe(true)
  expect(h.next).not.toHaveBeenCalled()
  exports[0].resolve({ filePath: '/old-downloads/0.mp3', size: 100 })
  await vi.waitFor(() => expect(h.post).toHaveBeenCalledTimes(4))
  expect(JSON.parse(data.get(key)!).jobs).toHaveLength(4)
  store.getState().cancelSave()
  expect(JSON.parse(data.get(key)!).jobs).toEqual([])
  exports.forEach(item => item.resolve({ filePath: '/old-downloads/song.mp3', size: 100 }))
})

it('任务入队立即保存，进度和面板切换不重复写入，失败和取消不会在下次启动复活', async () => {
  const { store } = await start()
  store.setState({ downloadDir: '/downloads', paused: true })
  await store.getState().saveMany([track, { ...track, id: '2' }])
  const writes = storage.setItem.mock.calls.length
  store.setState(state => ({ jobs: state.jobs.map(job => ({ ...job, receivedBytes: 42, status: 'saving' })) }))
  expect(storage.setItem).toHaveBeenCalledTimes(writes)
  store.setState(state => ({ jobs: state.jobs.map(job => job.track.id === '1' ? { ...job, status: 'failed', error: '不可下载' } : job) }))
  expect(JSON.parse(data.get(key)!).jobs.map((job: { track: Track }) => job.track.id)).toEqual(['2'])
  store.getState().cancelSave('qq:2')
  expect(JSON.parse(data.get(key)!).jobs).toEqual([])
})

it('恢复过滤损坏记录和非下载平台，按来源身份去重并剥除旧直链', async () => {
  const job = { track, directory: '/downloads' }
  data.set(key, JSON.stringify({ schema: 1, jobs: [null, job, job,
    { ...job, track: { ...track, id: null } }, { ...job, directory: '' },
    { ...job, track: { ...track, source: 'apple', provider: 'apple' } },
    { ...job, track: { ...track, source: 'local', provider: 'local' } },
    { ...job, track: { ...track, source: 'netease', provider: 'netease' } }
  ] }))
  const { store } = await start()
  expect(store.getState().jobs.map(job => job.track.source)).toEqual(['qq', 'netease'])
  expect(store.getState().jobs.every(job => !job.track.url && !job.controller.signal.aborted)).toBe(true)
})

it.each(['{broken', '{"schema":2,"jobs":[]}', 'null'])('损坏或未知格式存档 %s 不阻断启动或主动写坏原数据', async raw => {
  data.set(key, raw)
  const { store } = await start()
  expect(store.getState().jobs).toEqual([])
  expect(data.get(key)).toBe(raw)
})

it('存储不可用不阻断下载，显示恢复风险，下一次成功保存清除错误', async () => {
  storage.setItem.mockImplementationOnce(() => { throw new Error('quota') })
  const { store } = await start()
  store.setState({ downloadDir: '/downloads', paused: true })
  await store.getState().saveMany([track])
  expect(store.getState().jobs).toHaveLength(1)
  expect(store.getState().recoveryError).toContain('无法保存')
  await store.getState().saveMany([{ ...track, id: '2' }])
  expect(store.getState().recoveryError).toBe('')
  expect(JSON.parse(data.get(key)!).jobs).toHaveLength(2)
})

it('启动读取存档失败后新任务不覆盖未恢复的旧队列，重启后仍能恢复旧任务', async () => {
  const raw = JSON.stringify({ schema: 1, jobs: [{ track, directory: '/old-downloads' }] })
  data.set(key, raw)
  storage.getItem.mockImplementationOnce(() => { throw Error('temporary read failure') })
  const { store } = await start()
  expect(store.getState().recoveryError).toContain('无法读取')
  store.setState({ downloadDir: '/new-downloads', paused: true })
  await store.getState().saveMany([{ ...track, id: 'new' }])
  stop!()
  expect(data.get(key)).toBe(raw)
  vi.resetModules()
  const fresh = await start()
  expect(fresh.store.getState().jobs).toMatchObject([{ track: { id: '1' }, directory: '/old-downloads', status: 'queued' }])
})

it('停止时使等待目录的旧添加操作失效，不能在退出后重新创建任务', async () => {
  const { store } = await start()
  const directory = deferred<{ dir: string }>()
  h.get.mockReturnValueOnce(directory.promise)
  const adding = store.getState().saveMany([track])
  stop!()
  directory.resolve({ dir: '/downloads' })
  await expect(adding).rejects.toMatchObject({ name: 'AbortError' })
  expect(store.getState().jobs).toEqual([])
  expect(h.status).not.toHaveBeenCalled()
})

it.each(['cancel', 'done', 'failed'] as const)('%s 清理存档短暂失败后退出重试，冷启动不能复活已结束任务', async terminal => {
  const { store } = await start()
  store.setState({ downloadDir: '/downloads', paused: true })
  await store.getState().saveMany([track])
  expect(JSON.parse(data.get(key)!).jobs).toHaveLength(1)
  storage.setItem.mockImplementationOnce(() => { throw Error('temporary failure') })
  if (terminal === 'cancel') store.getState().cancelSave()
  else store.setState(state => ({ jobs: state.jobs.map(job => ({ ...job, status: terminal })) }))
  expect(store.getState().recoveryError).toContain('无法保存')
  stop!()
  expect(JSON.parse(data.get(key)!).jobs).toEqual([])
  vi.resetModules()
  const fresh = await start()
  expect(fresh.store.getState().jobs).toEqual([])
})
