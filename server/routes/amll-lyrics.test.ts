import type { IncomingMessage, ServerResponse } from 'node:http'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { amllLyricRoutes } from './amll-lyrics'

const h = vi.hoisted(() => ({ fetch: vi.fn(), probe: vi.fn() }))
vi.mock('../lib/amll-lyrics', async (importOriginal) => ({ ...await importOriginal<typeof import('../lib/amll-lyrics')>(), fetchAmllLyric: h.fetch, probeAmllHosts: h.probe }))

async function request(query: string, method = 'GET', path = '/api/amll/lyric') {
  const res = { writeHead: vi.fn(), end: vi.fn() }
  const handled = await amllLyricRoutes({ method } as IncomingMessage, res as unknown as ServerResponse, new URL(`http://localhost${path}?${query}`), { userDataDir: '/test-profile', port: 0 })
  return { handled, status: res.writeHead.mock.calls[0]?.[0], body: JSON.parse(res.end.mock.calls[0][0].toString()) }
}

describe('AMLL 逐字歌词接口', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('返回命中的原文，库里没有时 text 为 null', async () => {
    h.fetch.mockResolvedValueOnce('YRC').mockResolvedValueOnce(null)
    expect(await request('platform=ncm&id=42')).toMatchObject({ handled: true, status: 200, body: { text: 'YRC' } })
    expect(await request('platform=qq&id=abcdef12')).toMatchObject({ status: 200, body: { text: null } })
    expect(h.fetch).toHaveBeenNthCalledWith(1, '/test-profile', 'ncm', '42', fetch, Date.now, undefined)
  })

  it.each(['platform=ncm&id=..%2F1', 'platform=spotify&id=1', 'platform=ncm', 'id=1'])('拒绝非法参数：%s', async (query) => {
    expect((await request(query)).status).toBe(400)
    expect(h.fetch).not.toHaveBeenCalled()
  })

  it('上游失败返回 502，不抛出', async () => {
    h.fetch.mockRejectedValueOnce(new Error('UPSTREAM_503'))
    expect(await request('platform=ncm&id=1')).toMatchObject({ status: 502, body: { text: null } })
  })

  it('拒绝非 GET 请求', async () => {
    expect((await request('platform=ncm&id=1', 'POST')).status).toBe(405)
  })

  it('优先线路只接受已知线路 ID，未知值忽略', async () => {
    h.fetch.mockResolvedValue(null)
    await request('platform=ncm&id=1&host=bikonoo')
    expect(h.fetch.mock.calls[0][5]).toBe('bikonoo')
    await request('platform=ncm&id=1&host=evil.example.com')
    expect(h.fetch.mock.calls[1][5]).toBeUndefined()
  })

  it('测速接口返回各线路延迟', async () => {
    h.probe.mockResolvedValue([{ id: 'github', ms: 300 }, { id: 'gbclstudio', ms: null }])
    expect(await request('', 'GET', '/api/amll/probe')).toMatchObject({ status: 200, body: { hosts: [{ id: 'github', ms: 300 }, { id: 'gbclstudio', ms: null }] } })
  })
})

