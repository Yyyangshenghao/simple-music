import type { IncomingMessage, ServerResponse } from 'node:http'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../lib/netease-client', async original => ({
  ...await original<typeof import('../lib/netease-client')>(),
  call: h.call, has: () => true, requireLogin: async () => ({ loggedIn: true, userId: 7 }),
}))
vi.mock('../lib/cookie', () => ({ getCookie: () => 'cookie-a' }))
import { neteaseRoutes } from './netease'

async function check() {
  const res = { writeHead: vi.fn(), end: vi.fn() }
  await neteaseRoutes({} as IncomingMessage, res as unknown as ServerResponse,
    new URL('http://localhost/api/song/like/check?ids=1,2'), { userDataDir: '', port: 0 })
  return { status: res.writeHead.mock.calls[0][0], body: JSON.parse(res.end.mock.calls[0][0].toString()) }
}

beforeEach(() => { vi.resetAllMocks() })

describe('红心状态查询请求次数', () => {
  it.each([[], { '1': false, '2': false }])('直接查询成功且全部未喜欢时不再拉全量列表：%j', async data => {
    h.call.mockResolvedValue({ status: 200, body: { code: 200, data } })
    expect(await check()).toMatchObject({ status: 200, body: { liked: { '1': false, '2': false } } })
    expect(h.call).toHaveBeenCalledTimes(1)
  })

  it('直接查询失败时仍可用全量列表兜底', async () => {
    h.call.mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ status: 200, body: { ids: [2] } })
    expect((await check()).body.liked).toEqual({ '1': false, '2': true })
    expect(h.call).toHaveBeenCalledTimes(2)
  })

  it.each([{ code: 500, data: [] }, { code: 200, data: { unknown: [] } }])('不把失败或未知结构当成未喜欢：%j', async body => {
    h.call.mockResolvedValueOnce({ status: 200, body })
      .mockResolvedValueOnce({ status: 200, body: { ids: [2] } })
    expect((await check()).body.liked).toEqual({ '1': false, '2': true })
    expect(h.call).toHaveBeenCalledTimes(2)
  })

  it.each([{ code: 200, data: [2] }, { code: 200, '1': false, '2': true }])('有效红心结果保持映射：%j', async body => {
    h.call.mockResolvedValue({ status: 200, body })
    expect((await check()).body.liked).toEqual({ '1': false, '2': true })
    expect(h.call).toHaveBeenCalledTimes(1)
  })

  it.each(['resolve', 'reject'])('明确风控（%s）时不再用全量列表兜底', async mode => {
    const limited = { status: 400, body: { code: -460 } }
    if (mode === 'resolve') h.call.mockResolvedValueOnce(limited)
    else h.call.mockRejectedValueOnce(limited)
    expect((await check()).status).toBe(500)
    expect(h.call).toHaveBeenCalledTimes(1)
  })
})
