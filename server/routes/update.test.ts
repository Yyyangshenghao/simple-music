import type { IncomingMessage, ServerResponse } from 'node:http'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { updateRoutes } from './update'
import { sendJson } from '../lib/http'
import { fetchLatestUpdateInfo, startUpdateDownloadJob, type JobResult, type UpdateInfo } from '../lib/update'

vi.mock('../lib/http', () => ({ sendJson: vi.fn() }))
vi.mock('../lib/update', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/update')>(),
  fetchLatestUpdateInfo: vi.fn(),
  startUpdateDownloadJob: vi.fn(),
}))

describe('更新下载路由的异步任务启动', () => {
  const req = {} as IncomingMessage
  const res = {} as ServerResponse
  const ctx = { userDataDir: '/unused', port: 35530 }
  const url = new URL('http://localhost/api/update/download')

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(fetchLatestUpdateInfo).mockResolvedValue({} as UpdateInfo)
  })

  it('缓存校验完成后再发送任务结果', async () => {
    let finish!: (job: JobResult) => void
    vi.mocked(startUpdateDownloadJob).mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    const handling = updateRoutes(req, res, url, ctx)
    await vi.waitFor(() => expect(startUpdateDownloadJob).toHaveBeenCalledTimes(1))
    expect(sendJson).not.toHaveBeenCalled()
    const job = { ok: true, id: 'cached-installer', status: 'ready' } as JobResult
    finish(job)
    await expect(handling).resolves.toBe(true)
    expect(sendJson).toHaveBeenCalledWith(res, job, 200)
  })

  it('保留任务启动失败的 400 状态', async () => {
    const job = { ok: false, error: 'NO_UPDATE_AVAILABLE' } as const
    vi.mocked(startUpdateDownloadJob).mockResolvedValue(job)
    await expect(updateRoutes(req, res, url, ctx)).resolves.toBe(true)
    expect(sendJson).toHaveBeenCalledWith(res, job, 400)
  })

  it('异步启动抛错仍返回 500', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(startUpdateDownloadJob).mockRejectedValue(new Error('read failed'))
    try {
      await expect(updateRoutes(req, res, url, ctx)).resolves.toBe(true)
      expect(sendJson).toHaveBeenCalledWith(res, { ok: false, error: 'read failed' }, 500)
    } finally {
      log.mockRestore()
    }
  })
})
