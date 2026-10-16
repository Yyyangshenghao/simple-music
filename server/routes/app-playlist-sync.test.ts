import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { beforeEach, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ call: vi.fn(), cookie: vi.fn(), login: vi.fn() }))
vi.mock('../lib/netease-client', async original => ({ ...await original<typeof import('../lib/netease-client')>(), call: h.call, requireLogin: h.login }))
vi.mock('../lib/cookie', async original => ({ ...await original<typeof import('../lib/cookie')>(), getCookie: h.cookie }))
import { playbackAccountToken } from '../lib/playback-account'
import { appPlaylistSyncRoutes } from './app-playlist-sync'

let caseId = 0
let remote: { id: string; name: string; ids: string[]; creator: { userId: number }; specialType: number; subscribed?: boolean }
const response = (body: object) => ({ status: 200, body: { code: 200, ...body } })
async function upstream(method: string, input: Record<string, unknown>) {
  if (method === 'playlist_detail') return response({ playlist: { ...remote, trackCount: remote.ids.length, trackIds: remote.ids.map(id => ({ id })) } })
  if (method === 'playlist_create') { remote.name = String(input.name); remote.ids = []; return response({ playlist: { id: remote.id } }) }
  if (method === 'playlist_tracks') {
    const ids = String(input.tracks).split(',')
    remote.ids = input.op === 'add' ? [...new Set([...remote.ids, ...ids])].reverse() : remote.ids.filter(id => !ids.includes(id))
  }
  if (method === 'song_order_update') remote.ids = JSON.parse(String(input.ids))
  if (method === 'playlist_name_update') remote.name = String(input.name)
  return response({})
}
async function sync(overrides: object = {}, method = 'POST', session = false) {
  const body = { appPlaylistId: `app-${caseId}`, name: '应用歌单', accountId: '7', accountToken: playbackAccountToken('cookie-a'), tracks: ['3', '1', '2'].map(id => ({ source: 'netease', id })), ...overrides }
  const req = Readable.from([Buffer.from(JSON.stringify(body))]) as IncomingMessage
  req.method = method
  const res = { destroyed: false, writeHead: vi.fn(), end: vi.fn(), setHeader: vi.fn() }
  await appPlaylistSyncRoutes(req, res as unknown as ServerResponse, new URL(`http://localhost/api/netease/app-playlist-sync${session ? '/session' : ''}`), { userDataDir: 'test', port: 0 })
  return { status: res.writeHead.mock.calls[0]?.[0], body: res.end.mock.calls.length ? JSON.parse(res.end.mock.calls[0][0].toString()) : null }
}
beforeEach(() => {
  caseId++
  vi.resetAllMocks()
  h.login.mockResolvedValue({ userId: 7 })
  h.cookie.mockReturnValue('cookie-a')
  remote = { id: '201', name: '原歌单', ids: [], creator: { userId: 7 }, specialType: 0 }
  h.call.mockImplementation(upstream)
})
it('登录上下文不缓存，首次创建私密歌单并回读确认完整顺序', async () => {
  expect((await sync({}, 'GET', true)).body).toMatchObject({ accountId: '7', accountToken: expect.any(String) })
  expect(await sync()).toMatchObject({ status: 200, body: { success: true, playlistId: '201' } })
  expect(h.call).toHaveBeenCalledWith('playlist_create', expect.objectContaining({ privacy: '10', cookie: 'cookie-a' }))
  expect(remote.ids).toEqual(['3', '1', '2'])
  expect(h.call.mock.calls.at(-1)?.[0]).toBe('playlist_detail')
})
it('后续更新同一目标，只补增删差集并同步名称和顺序', async () => {
  remote.ids = ['9', '2', '1']
  expect((await sync({ playlistId: '201' })).body.success).toBe(true)
  expect(h.call.mock.calls.filter(([method]) => method === 'playlist_tracks').map(([, args]) => [args.op, args.tracks])).toEqual([['add', '3'], ['del', '9']])
  expect(h.call.mock.calls.some(([method]) => method === 'playlist_create')).toBe(false)
  expect(remote.name).toBe('应用歌单')
  expect(remote.ids).toEqual(['3', '1', '2'])
})
it('相同内容不重复写入', async () => {
  remote.ids = ['3', '1', '2']; remote.name = '应用歌单'
  expect((await sync({ playlistId: '201' })).body.success).toBe(true)
  expect(h.call.mock.calls.every(([method]) => method === 'playlist_detail')).toBe(true)
})
it.each([
  { tracks: [] }, { tracks: [{ source: 'qq', id: '1' }] }, { tracks: [{ source: 'apple', id: '1' }] },
  { tracks: [{ source: 'local', id: '1' }] }, { tracks: [{ source: 'netease', id: 'bad' }] },
  { tracks: [{ source: 'netease', id: '1' }, { source: 'netease', id: '1' }] }, { playlistId: 'bad' }, { name: ' ' },
])('无效或跨源输入不发上游请求 %j', async input => {
  expect((await sync(input)).status).toBe(400)
  expect(h.call).not.toHaveBeenCalled()
})
it.each([{ creator: { userId: 8 } }, { specialType: 5 }, { subscribed: true }])('拒绝非本人普通歌单 %j', async target => {
  Object.assign(remote, target)
  expect((await sync({ playlistId: '201' })).body).toMatchObject({ success: false, error: expect.stringContaining('普通歌单') })
  expect(h.call.mock.calls.every(([method]) => method === 'playlist_detail')).toBe(true)
})
it('旧账号凭证和非POST方法不触发写入', async () => {
  expect((await sync({ accountId: '8' })).status).toBe(409)
  expect((await sync({ accountToken: 'old' })).status).toBe(409)
  expect((await sync({}, 'GET')).status).toBe(405)
  expect(h.call).not.toHaveBeenCalled()
})
it('回查中切换Cookie后不继续修改云端', async () => {
  h.call.mockImplementation(async (method, args) => { const result = await upstream(method, args); h.cookie.mockReturnValue('cookie-b'); return result })
  expect((await sync({ playlistId: '201' })).body.success).toBe(false)
  expect(h.call).toHaveBeenCalledTimes(1)
})
it('详情缺少完整ID列表时不修改任何歌曲', async () => {
  h.call.mockResolvedValue(response({ playlist: { ...remote, trackCount: 50 } }))
  expect((await sync({ playlistId: '201' })).body.error).toContain('不完整')
  expect(h.call).toHaveBeenCalledTimes(1)
})
it('创建后失败返回目标，重试复用检查点而不新建', async () => {
  let fail = true
  h.call.mockImplementation(async (method, args) => method === 'playlist_tracks' && fail ? response({ code: 500, message: '操作频繁' }) : upstream(method, args))
  expect((await sync()).body).toMatchObject({ success: false, playlistId: '201', error: '操作频繁' })
  fail = false
  expect((await sync()).body.success).toBe(true)
  expect(h.call.mock.calls.filter(([method]) => method === 'playlist_create')).toHaveLength(1)
})
it('上游静默漏歌或排序未生效均不能报告成功', async () => {
  h.call.mockImplementation(async (method, args) => method === 'playlist_tracks' ? response({}) : upstream(method, args))
  expect((await sync()).body.error).toContain('部分歌曲')
  h.call.mockImplementation(async (method, args) => method === 'song_order_update' ? response({}) : upstream(method, args))
  expect((await sync()).body.success).toBe(false)
})
it('重复请求不能释放第一份请求的写锁', async () => {
  let release!: () => void
  h.call.mockImplementationOnce(async (method, args) => { await new Promise<void>(resolve => { release = resolve }); return upstream(method, args) })
  const first = sync({ playlistId: '201' })
  await vi.waitFor(() => expect(release).toBeTypeOf('function'))
  expect((await sync({ playlistId: '201' })).status).toBe(409)
  expect((await sync({ playlistId: '201' })).status).toBe(409)
  release()
  expect((await first).body.success).toBe(true)
})
it('870首歌分批添加并按完整顺序排序', async () => {
  const ids = Array.from({ length: 870 }, (_, i) => String(870 - i))
  expect((await sync({ tracks: ids.map(id => ({ source: 'netease', id })) })).body.success).toBe(true)
  expect(h.call.mock.calls.filter(([method]) => method === 'playlist_tracks')).toHaveLength(9)
  expect(remote.ids).toEqual(ids)
})
it('创建成功但账号切换时先保存检查点，旧账号回来重试仍复用目标', async () => {
  h.call.mockImplementation(async (method, args) => {
    const result = await upstream(method, args)
    if (method === 'playlist_create') h.cookie.mockReturnValue('cookie-b')
    return result
  })
  expect((await sync()).body).toMatchObject({ success: false, playlistId: '201' })
  h.cookie.mockReturnValue('cookie-a'); h.call.mockImplementation(upstream)
  expect((await sync()).body.success).toBe(true)
  expect(h.call.mock.calls.filter(([method]) => method === 'playlist_create')).toHaveLength(1)
})
it('新增接口静默漏歌时保留旧曲目，不继续删除差集', async () => {
  remote.ids = ['9']
  h.call.mockImplementation(async (method, args) => method === 'playlist_tracks' && args.op === 'add' ? response({}) : upstream(method, args))
  expect((await sync({ playlistId: '201' })).body.success).toBe(false)
  expect(remote.ids).toEqual(['9'])
  expect(h.call.mock.calls.some(([method, args]) => method === 'playlist_tracks' && args.op === 'del')).toBe(false)
})
it('已经关联的歌单可手动同步为空，只清曲目不删除歌单', async () => {
  remote.ids = ['1', '2']
  expect((await sync({ playlistId: '201', tracks: [] })).body).toMatchObject({ success: true, playlistId: '201' })
  expect(remote.ids).toEqual([])
  expect(h.call.mock.calls.some(([method]) => method === 'playlist_create' || method === 'playlist_delete')).toBe(false)
})
it('空列表的旧云端目标已删除时不重建空歌单', async () => {
  h.call.mockResolvedValue(response({ code: 404 }))
  expect((await sync({ playlistId: '201', tracks: [] })).body).toMatchObject({ success: false, error: expect.stringContaining('已删除') })
  expect(h.call.mock.calls.some(([method]) => method === 'playlist_create')).toBe(false)
})
it('详情网络错误不能误判删除后新建歌单', async () => {
  h.call.mockRejectedValue(new Error('network unavailable'))
  expect((await sync({ playlistId: '201' })).body.success).toBe(false)
  expect(h.call).toHaveBeenCalledTimes(1)
})
