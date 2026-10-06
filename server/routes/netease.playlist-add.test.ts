import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ call: vi.fn(), cookie: vi.fn(), login: vi.fn() }))
vi.mock('../lib/netease-client', async (original) => ({ ...await original<typeof import('../lib/netease-client')>(), call: h.call, requireLogin: h.login, getLoginInfo: h.login }))
vi.mock('../lib/cookie', async (original) => ({ ...await original<typeof import('../lib/cookie')>(), getCookie: h.cookie }))
import { neteaseRoutes } from './netease'
async function add(onRes?: (res: { destroyed: boolean }) => void) {
  const req = Readable.from([Buffer.from(JSON.stringify({ pid: '123', ids: '1,2' }))]) as IncomingMessage
  req.method = 'POST'
  const res = { destroyed: false, writeHead: vi.fn(), end: vi.fn() }
  onRes?.(res)
  await neteaseRoutes(req, res as unknown as ServerResponse, new URL('http://localhost/api/playlist/add-song'), { userDataDir: '', port: 0 })
  return { status: res.writeHead.mock.calls[0]?.[0], body: res.end.mock.calls[0] ? JSON.parse(res.end.mock.calls[0][0].toString()) : null }
}
describe('歌单批量追加归属检查', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    h.login.mockResolvedValue({ loggedIn: true, userId: 7 })
    h.cookie.mockReturnValue('cookie-a')
    h.call.mockImplementation(async (name) => ({ status: 200, cookie: [], body: name === 'playlist_detail' ? { playlist: { creator: { userId: 7 }, specialType: 0 } } : { code: 200 } }))
  })
  it('本人普通歌单只执行 add，不删除现有歌曲', async () => {
    expect((await add()).body.success).toBe(true)
    expect(h.call).toHaveBeenLastCalledWith('playlist_tracks', expect.objectContaining({ op: 'add', tracks: '1,2', pid: '123', cookie: 'cookie-a' }))
    expect(h.call.mock.calls.some(([, args]) => args.op === 'del')).toBe(false)
  })
  it.each([{ creator: { userId: 8 } }, { creator: { userId: 7 }, subscribed: true }, { creator: { userId: 7 }, specialType: 5 }])('收藏、他人和我喜欢歌单不能作为批量写入目标', async (playlist) => {
    h.call.mockResolvedValue({ status: 200, body: { playlist } })
    expect(await add()).toMatchObject({ status: 409, body: { error: 'PLAYLIST_NOT_WRITABLE' } })
    expect(h.call).toHaveBeenCalledTimes(1)
  })
  it('归属回查中切账号后不再写入旧账号', async () => {
    h.cookie.mockReturnValueOnce('cookie-a').mockReturnValue('cookie-b')
    expect(await add()).toMatchObject({ status: 409, body: { error: 'ACCOUNT_CHANGED' } })
    expect(h.call).toHaveBeenCalledTimes(1)
  })
  it('用户在归属回查期间取消后不再发起上游写入', async () => {
    let response: { destroyed: boolean }
    h.call.mockImplementation(async () => {
      response.destroyed = true
      return { status: 200, body: { playlist: { creator: { userId: 7 }, specialType: 0 } } }
    })
    await add((res) => { response = res })
    expect(h.call).toHaveBeenCalledTimes(1)
  })

})
