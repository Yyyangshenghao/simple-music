import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/bilibili-client', async original => ({
  ...await original<typeof import('../lib/bilibili-client')>(), getBilibiliVideoTrack: vi.fn(),
}))
import { BilibiliRiskError, getBilibiliVideoTrack } from '../lib/bilibili-client'
import { bilibiliRoutes } from './bilibili'

afterEach(() => { vi.resetAllMocks(); vi.restoreAllMocks() })

async function request(query: string, method = 'GET') {
  const res = { writeHead: vi.fn(), end: vi.fn() }
  await bilibiliRoutes({ method } as IncomingMessage, res as unknown as ServerResponse,
    new URL(`http://localhost/api/bilibili/song/detail?${query}`), { userDataDir: '', port: 0 })
  return { status: res.writeHead.mock.calls[0][0], body: JSON.parse(res.end.mock.calls[0][0]) }
}

describe('B站视频详情路由', () => {
  it.each(['', 'bvid=bad', 'bvid=https%3A%2F%2Fexample.com'])('拒绝不规范身份 %s', async query => {
    expect((await request(query)).status).toBe(400)
    expect(getBilibiliVideoTrack).not.toHaveBeenCalled()
  })

  it('只接受GET，并返回固定BV对应歌曲', async () => {
    expect((await request('bvid=BV1BZbSzZEGT', 'POST')).status).toBe(405)
    const track = { id: 'BV1BZbSzZEGT', source: 'bilibili' }
    vi.mocked(getBilibiliVideoTrack).mockResolvedValue(track as Awaited<ReturnType<typeof getBilibiliVideoTrack>>)
    expect(await request('bvid=BV1BZbSzZEGT')).toEqual({ status: 200, body: { track } })
    expect(getBilibiliVideoTrack).toHaveBeenCalledWith('BV1BZbSzZEGT')
  })

  it('风控与其他读取失败分别返回503和502', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(getBilibiliVideoTrack).mockRejectedValueOnce(new BilibiliRiskError('risk')).mockRejectedValueOnce(new Error('offline'))
    expect((await request('bvid=BV1BZbSzZEGT')).status).toBe(503)
    expect((await request('bvid=BV1BZbSzZEGT')).status).toBe(502)
  })
})
