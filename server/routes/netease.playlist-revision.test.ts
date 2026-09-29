import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/netease-client', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/netease-client')>(),
  call: vi.fn(),
}))
import { call } from '../lib/netease-client'
import { neteaseRoutes } from './netease'

async function request(path = '/api/playlist/revision?id=123') {
  const res = { writeHead: vi.fn(), end: vi.fn() }
  const handled = await neteaseRoutes(
    {} as IncomingMessage, res as unknown as ServerResponse,
    new URL(`http://localhost${path}`), { userDataDir: '', port: 0 }
  )
  return { handled, status: res.writeHead.mock.calls[0]?.[0], body: JSON.parse(res.end.mock.calls[0][0].toString()) }
}

describe('网易云歌单轻量变更检查', () => {
  afterEach(() => vi.restoreAllMocks())

  it('返回曲目更新时间和完整有序 ID，不请求歌曲详情', async () => {
    vi.mocked(call).mockResolvedValue({ status: 200, cookie: [], body: { playlist: {
      id: 123, trackUpdateTime: 456, trackIds: [{ id: 2 }, { id: 1 }],
    } } })
    expect(await request()).toEqual({ handled: true, status: 200, body: { updatedAt: 456, trackIds: ['2', '1'] } })
    expect(call).toHaveBeenCalledTimes(1)
    expect(call).toHaveBeenCalledWith('playlist_detail', expect.objectContaining({ id: '123', s: 0 }))
  })

  it('缺少更新时间时仍返回有序 ID', async () => {
    vi.mocked(call).mockResolvedValue({ status: 200, cookie: [], body: { playlist: { id: 123, trackIds: [{ id: 1 }] } } })
    expect((await request()).body).toEqual({ updatedAt: null, trackIds: ['1'] })
  })

  it('上游未返回曲目关系时不误报为空歌单', async () => {
    vi.mocked(call).mockResolvedValue({ status: 200, cookie: [], body: { playlist: { id: 123, trackCount: 2 } } })
    expect((await request()).status).toBe(500)
  })

  it('已清空的歌单直接返回空骨架，不调用备用接口', async () => {
    vi.mocked(call).mockImplementation(async (name) => {
      if (name === 'playlist_detail') return { status: 200, cookie: [], body: { playlist: { id: 123, trackCount: 0, trackIds: [] } } }
      throw new Error('fallback unavailable')
    })
    expect(await request('/api/playlist/tracks?id=123')).toMatchObject({ status: 200, body: { trackIds: [], tracks: [] } })
    expect(call).toHaveBeenCalledTimes(1)
  })
})
