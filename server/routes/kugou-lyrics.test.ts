import type { IncomingMessage, ServerResponse } from 'node:http'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { kugouLyricRoutes } from './kugou-lyrics'

const h = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('../lib/kugou-lyrics', async (importOriginal) => ({ ...await importOriginal<typeof import('../lib/kugou-lyrics')>(), fetchKugouLyric: h.fetch }))

async function request(query: string, method = 'GET', path = '/api/kugou/lyric') {
  const res = { writeHead: vi.fn(), end: vi.fn() }
  const handled = await kugouLyricRoutes({ method } as IncomingMessage, res as unknown as ServerResponse, new URL(`http://localhost${path}?${query}`), { userDataDir: '/test-profile', port: 0 })
  return { handled, status: res.writeHead.mock.calls[0]?.[0], body: handled ? JSON.parse(res.end.mock.calls[0][0].toString()) : null }
}

describe('酷狗逐字歌词接口', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('返回候选列表', async () => {
    h.fetch.mockResolvedValueOnce([{ title: '晴天', artist: '周杰伦', duration: 269000, text: 'KRC' }])
    expect(await request('title=晴天&artist=周杰伦&duration=269000')).toMatchObject({ handled: true, status: 200, body: { candidates: [{ text: 'KRC' }] } })
    expect(h.fetch).toHaveBeenCalledWith('/test-profile', { title: '晴天', artist: '周杰伦', duration: 269000 })
  })

  it.each(['artist=a&duration=1000', 'title=a', 'title=a&duration=-1'])('拒绝非法参数：%s', async (query) => {
    expect((await request(query)).status).toBe(400)
    expect(h.fetch).not.toHaveBeenCalled()
  })

  it('上游失败返回 502', async () => {
    h.fetch.mockRejectedValueOnce(new Error('UPSTREAM_UNAVAILABLE'))
    expect(await request('title=a&duration=200000')).toMatchObject({ status: 502, body: { candidates: [] } })
  })

  it('拒绝非 GET 请求，不处理其他路径', async () => {
    expect((await request('title=a&duration=200000', 'POST')).status).toBe(405)
    expect((await request('', 'GET', '/api/other')).handled).toBe(false)
  })
})
