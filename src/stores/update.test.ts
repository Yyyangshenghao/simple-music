import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../lib/api'
import { AUTO_CHECK_INTERVAL_MS, FOCUS_CHECK_MIN_GAP_MS, startUpdateAutoCheck, useUpdateStore, type DownloadJob, type UpdateInfo } from './update'

vi.mock('../lib/api', () => ({ api: { get: vi.fn(), post: vi.fn() } }))

function downloadJob(id = 'job-a', status: DownloadJob['status'] = 'queued'): DownloadJob {
  return {
    ok: true, id, status, progress: status === 'ready' ? 100 : 0,
    received: 0, total: 0, speedBps: 0, etaSeconds: 0, sourceLabel: '',
    message: '', fileName: '', filePath: status === 'ready' ? '/updates/app.dmg' : '',
    version: '2.3.1', error: '', errorReason: '',
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const update = () => useUpdateStore.getState()

beforeEach(() => {
  vi.useFakeTimers()
  vi.resetAllMocks()
  useUpdateStore.setState({ job: null, downloading: false, installing: false })
  vi.mocked(api.post).mockResolvedValue(downloadJob())
  vi.mocked(api.get).mockResolvedValue(downloadJob('job-a', 'downloading'))
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('更新下载轮询', () => {
  it('连续开始下载时只创建一次任务', async () => {
    const starting = deferred<DownloadJob>()
    vi.mocked(api.post).mockReturnValueOnce(starting.promise)
    const first = update().startDownload()
    await update().startDownload()
    expect(api.post).toHaveBeenCalledOnce()
    expect(update().downloading).toBe(true)
    starting.resolve(downloadJob('job-a', 'ready'))
    await first
    expect(update().downloading).toBe(false)
  })

  it('慢状态请求不重叠，完成后再等待 800 ms 查询', async () => {
    const pending = deferred<DownloadJob>()
    vi.mocked(api.get).mockReturnValueOnce(pending.promise)
    await update().startDownload()
    await vi.advanceTimersByTimeAsync(799)
    expect(api.get).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(5001)
    expect(api.get).toHaveBeenCalledOnce()
    pending.resolve(downloadJob('job-a', 'downloading'))
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(799)
    expect(api.get).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1)
    expect(api.get).toHaveBeenCalledTimes(2)
  })

  it.each(['ready', 'error'] as const)('状态达到 %s 后停止轮询', async status => {
    vi.mocked(api.get).mockResolvedValueOnce(downloadJob('job-a', status))
    await update().startDownload()
    await vi.advanceTimersByTimeAsync(800)
    expect(update()).toMatchObject({ job: { id: 'job-a', status }, downloading: false })
    await vi.advanceTimersByTimeAsync(5000)
    expect(api.get).toHaveBeenCalledOnce()
  })

  it.each(['ready', 'error'] as const)('创建任务直接返回 %s 时不轮询', async status => {
    vi.mocked(api.post).mockResolvedValueOnce(downloadJob('job-a', status))
    await update().startDownload()
    expect(update().downloading).toBe(false)
    await vi.advanceTimersByTimeAsync(5000)
    expect(api.get).not.toHaveBeenCalled()
  })

  it('轮询始终携带创建任务的 ID，不依赖最新响应是否包含 ID', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ ...downloadJob('job-a', 'downloading'), id: undefined })
    await update().startDownload()
    await vi.advanceTimersByTimeAsync(1600)
    expect(api.get).toHaveBeenNthCalledWith(1, '/api/update/download/status', { id: 'job-a' })
    expect(api.get).toHaveBeenNthCalledWith(2, '/api/update/download/status', { id: 'job-a' })
  })

  it('状态查询失败后允许重试，新任务使用自己的 ID', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('offline'))
    await update().startDownload()
    await vi.advanceTimersByTimeAsync(800)
    expect(update().downloading).toBe(false)
    await vi.advanceTimersByTimeAsync(5000)
    expect(api.get).toHaveBeenCalledOnce()
    vi.mocked(api.post).mockResolvedValueOnce(downloadJob('job-b'))
    vi.mocked(api.get).mockResolvedValueOnce(downloadJob('job-b', 'ready'))
    await update().startDownload()
    await vi.advanceTimersByTimeAsync(800)
    expect(api.get).toHaveBeenLastCalledWith('/api/update/download/status', { id: 'job-b' })
    expect(update()).toMatchObject({ job: { id: 'job-b', status: 'ready' }, downloading: false })
  })

  it.each(['成功', '失败'] as const)('新下载已启动后，旧状态请求%s不能覆盖或停止新任务', async result => {
    const old = deferred<DownloadJob>()
    vi.mocked(api.get).mockReturnValueOnce(old.promise)
    await update().startDownload()
    await vi.advanceTimersByTimeAsync(800)
    // 旧下载已从 UI 状态释放，新下载开始时作废旧会话。
    useUpdateStore.setState({ downloading: false })
    vi.mocked(api.post).mockResolvedValueOnce(downloadJob('job-b'))
    vi.mocked(api.get).mockResolvedValueOnce(downloadJob('job-b', 'ready'))
    await update().startDownload()
    if (result === '成功') old.resolve(downloadJob('job-a', 'ready'))
    else old.reject(new Error('late failure'))
    await vi.advanceTimersByTimeAsync(0)
    expect(update()).toMatchObject({ job: { id: 'job-b', status: 'queued' }, downloading: true })
    await vi.advanceTimersByTimeAsync(800)
    expect(update()).toMatchObject({ job: { id: 'job-b', status: 'ready' }, downloading: false })
  })

  it('新会话开始后，迟到的任务创建响应不能替换新任务', async () => {
    const old = deferred<DownloadJob>()
    vi.mocked(api.post).mockReturnValueOnce(old.promise)
    const starting = update().startDownload()
    useUpdateStore.setState({ downloading: false })
    vi.mocked(api.post).mockResolvedValueOnce(downloadJob('job-b', 'ready'))
    await update().startDownload()
    old.resolve(downloadJob('job-a'))
    await starting
    expect(update()).toMatchObject({ job: { id: 'job-b', status: 'ready' }, downloading: false })
    await vi.advanceTimersByTimeAsync(5000)
    expect(api.get).not.toHaveBeenCalled()
  })

  it('创建任务失败后恢复操作入口', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error('offline'))
    await update().startDownload()
    expect(update()).toMatchObject({ job: null, downloading: false })
    vi.mocked(api.post).mockResolvedValueOnce(downloadJob('job-b', 'ready'))
    await update().startDownload()
    expect(update()).toMatchObject({ job: { id: 'job-b', status: 'ready' }, downloading: false })
  })
})

function updateInfo(version: string, patch: Partial<UpdateInfo> = {}): UpdateInfo {
  return {
    configured: true, preview: false, updateAvailable: version !== '2.6.0', currentVersion: '2.6.0', latestVersion: version,
    release: { tagName: `v${version}`, name: `Simple Music v${version}`, version, htmlUrl: '', downloadUrl: '', summary: '', notes: [] },
    ...patch,
  }
}

describe('开着时的自动检查', () => {
  let clock = 0
  let win: EventTarget
  let doc: EventTarget & { visibilityState: string }
  let stop: (() => void) | null = null

  beforeEach(() => {
    // 上次检查时间是模块级状态，每个用例把时钟推到足够远，互不影响。
    clock += 10 * AUTO_CHECK_INTERVAL_MS
    vi.setSystemTime(clock)
    win = new EventTarget()
    doc = Object.assign(new EventTarget(), { visibilityState: 'visible' })
    vi.stubGlobal('window', win)
    vi.stubGlobal('document', doc)
    useUpdateStore.setState({ info: null, checking: false, checkedAt: 0 })
    vi.mocked(api.get).mockResolvedValue(updateInfo('2.6.0'))
  })

  afterEach(() => {
    stop?.()
    stop = null
    vi.unstubAllGlobals()
  })

  it('启动时检查一次，之后按间隔定时检查', async () => {
    stop = startUpdateAutoCheck()
    await vi.advanceTimersByTimeAsync(0)
    expect(api.get).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(AUTO_CHECK_INTERVAL_MS - 60_000)
    expect(api.get).toHaveBeenCalledTimes(1)
    vi.mocked(api.get).mockResolvedValue(updateInfo('2.6.1'))
    await vi.advanceTimersByTimeAsync(30 * 60_000)
    expect(api.get).toHaveBeenCalledTimes(2)
    expect(update().info).toMatchObject({ updateAvailable: true, latestVersion: '2.6.1' })
  })

  it('回到前台时超过最短间隔才补查', async () => {
    stop = startUpdateAutoCheck()
    await vi.advanceTimersByTimeAsync(0)
    vi.setSystemTime(Date.now() + FOCUS_CHECK_MIN_GAP_MS - 1000)
    win.dispatchEvent(new Event('focus'))
    await vi.advanceTimersByTimeAsync(0)
    expect(api.get).toHaveBeenCalledTimes(1)
    vi.setSystemTime(Date.now() + 2000)
    doc.visibilityState = 'hidden'
    doc.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(0)
    expect(api.get).toHaveBeenCalledTimes(1)
    doc.visibilityState = 'visible'
    doc.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(0)
    expect(api.get).toHaveBeenCalledTimes(2)
  })

  it('检测失败的兜底结果不会冲掉已显示的新版本', async () => {
    useUpdateStore.setState({ info: updateInfo('2.6.1') })
    vi.mocked(api.get).mockResolvedValue(updateInfo('2.6.0', { updateAvailable: false, reason: 'GitHub Releases 403' }))
    await update().checkForUpdate()
    expect(update().info).toMatchObject({ updateAvailable: true, latestVersion: '2.6.1' })
  })

  it('下载进行中不替换版本信息', async () => {
    useUpdateStore.setState({ info: updateInfo('2.6.1'), downloading: true })
    vi.mocked(api.get).mockResolvedValue(updateInfo('2.6.2'))
    await update().checkForUpdate()
    expect(update().info).toMatchObject({ latestVersion: '2.6.1' })
  })

  it('停止后不再检查', async () => {
    stop = startUpdateAutoCheck()
    await vi.advanceTimersByTimeAsync(0)
    stop()
    stop = null
    vi.setSystemTime(Date.now() + AUTO_CHECK_INTERVAL_MS * 2)
    win.dispatchEvent(new Event('focus'))
    await vi.advanceTimersByTimeAsync(AUTO_CHECK_INTERVAL_MS)
    expect(api.get).toHaveBeenCalledTimes(1)
  })
})
