import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { beforeEach, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ call: vi.fn(), cookie: vi.fn(), login: vi.fn() }))
vi.mock('../lib/netease-client', async original => ({ ...await original<typeof import('../lib/netease-client')>(), call: h.call, requireLogin: h.login }))
vi.mock('../lib/cookie', async original => ({ ...await original<typeof import('../lib/cookie')>(), getCookie: h.cookie }))
import { neteaseRoutes } from './netease'

async function order(ids: unknown = ['3', '1', '2']) {
  const req = Readable.from([Buffer.from(JSON.stringify({ pid: '123', ids }))]) as IncomingMessage
  req.method = 'POST'
  const res = { destroyed: false, writeHead: vi.fn(), end: vi.fn() }
  await neteaseRoutes(req, res as unknown as ServerResponse, new URL('http://localhost/api/playlist/order/update'), { userDataDir: '', port: 0 })
  return { status: res.writeHead.mock.calls[0]?.[0], body: JSON.parse(res.end.mock.calls[0][0].toString()) }
}
const playlist = { creator: { userId: 7 }, specialType: 0, trackIds: [{ id: 2 }, { id: 3 }, { id: 1 }] }
beforeEach(() => {
  vi.resetAllMocks()
  h.login.mockResolvedValue({ userId: 7 })
  h.cookie.mockReturnValue('cookie-a')
  h.call.mockImplementation(async name => ({ status: 200, body: name === 'playlist_detail' ? { playlist } : { code: 200 } }))
})

it('本人普通歌单按完整输入顺序调用排序接口', async () => {
  expect(await order()).toMatchObject({ status: 200, body: { success: true } })
  expect(h.call).toHaveBeenLastCalledWith('song_order_update', expect.objectContaining({ pid: '123', ids: '["3","1","2"]', cookie: 'cookie-a' }))
})
it.each([[], ['1', '1'], ['no-id'], '1,2'])('非法排序 %j 不发上游请求', async ids => {
  expect((await order(ids)).status).toBe(400)
  expect(h.call).not.toHaveBeenCalled()
})
it.each([{ ...playlist, creator: { userId: 8 } }, { ...playlist, subscribed: true }, { ...playlist, specialType: 5 }])('非本人普通歌单不能排序', async target => {
  h.call.mockResolvedValue({ status: 200, body: { playlist: target } })
  expect((await order()).body.error).toBe('PLAYLIST_NOT_WRITABLE')
  expect(h.call).toHaveBeenCalledTimes(1)
})
it('回查中换号或歌单内容已变化时不提交旧顺序', async () => {
  h.cookie.mockReturnValueOnce('cookie-a').mockReturnValue('cookie-b')
  expect((await order()).body.error).toBe('ACCOUNT_CHANGED')
  h.cookie.mockReturnValue('cookie-a')
  expect((await order(['1', '2'])).body.error).toBe('PLAYLIST_CHANGED')
  expect(h.call.mock.calls.every(([name]) => name === 'playlist_detail')).toBe(true)
})
it('上游排序失败不能报告成功', async () => {
  h.call.mockImplementation(async name => ({ status: 200, body: name === 'playlist_detail' ? { playlist } : { code: 500, message: '操作频繁' } }))
  expect(await order()).toMatchObject({ status: 409, body: { success: false } })
})
