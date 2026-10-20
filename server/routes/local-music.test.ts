import type { IncomingMessage, ServerResponse } from 'node:http'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { localMusicRoutes } from './local-music'

const h = vi.hoisted(() => ({ body: vi.fn(), available: vi.fn() }))
vi.mock('../lib/http', async importOriginal => ({ ...await importOriginal<typeof import('../lib/http')>(), readBody: h.body }))
vi.mock('../lib/local-library', async importOriginal => ({ ...await importOriginal<typeof import('../lib/local-library')>(), availableLocalTrackIds: h.available }))

async function request(method: string, ids: unknown) {
  h.body.mockResolvedValue(JSON.stringify({ ids }))
  const res = { writeHead: vi.fn(), end: vi.fn() }
  const handled = await localMusicRoutes({ method } as IncomingMessage, res as unknown as ServerResponse, new URL('http://localhost/api/local/availability'), { userDataDir: '/test-profile', port: 0 })
  return { handled, status: res.writeHead.mock.calls[0][0], body: JSON.parse(res.end.mock.calls[0][0].toString()) }
}

describe('本地音乐可用状态接口', () => {
  beforeEach(() => { vi.clearAllMocks(); h.available.mockResolvedValue(['known']) })
  it('仅查询索引 ID，不接受客户端文件路径或返回真实路径', async () => {
    expect(await request('POST', ['known', 'missing'])).toEqual({ handled: true, status: 200, body: { availableIds: ['known'] } })
    expect(h.available).toHaveBeenCalledWith('/test-profile', ['known', 'missing'])
  })
  it.each([undefined, {}, [1], [''], Array(101).fill('known')])('拒绝无效或过量的 ID：%j', async ids => {
    expect((await request('POST', ids)).status).toBe(400)
    expect(h.available).not.toHaveBeenCalled()
  })
  it('拒绝非 POST 请求', async () => {
    expect((await request('GET', ['known'])).status).toBe(405)
    expect(h.body).not.toHaveBeenCalled()
  })
})
