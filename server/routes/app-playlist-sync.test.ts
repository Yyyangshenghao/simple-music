import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { beforeEach, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ call: vi.fn(), cookie: vi.fn(), login: vi.fn() }))
vi.mock('../lib/netease-client', async original => ({ ...await original<typeof import('../lib/netease-client')>(), call: h.call, requireLogin: h.login }))
vi.mock('../lib/cookie', async original => ({ ...await original<typeof import('../lib/cookie')>(), getCookie: h.cookie }))
import { playbackAccountToken } from '../lib/playback-account'
import { playlistSyncSnapshot } from '../lib/playlist-sync-report'
import { appPlaylistSyncRoutes } from './app-playlist-sync'

let caseId = 0
let remote: { id: string; name: string; ids: string[]; creator: { userId: number }; specialType: number; subscribed?: boolean }
const refs = (ids: string[]) => ids.map(id => ({ source: 'netease' as const, id }))
const revision = () => playlistSyncSnapshot(remote.name, refs(remote.ids)).revision
const response = (body: object) => ({ status: 200, body: { code: 200, ...body } })
const writes = () => h.call.mock.calls.filter(([method]) => method !== 'playlist_detail')
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
async function sync(overrides: Record<string, unknown> = {}, method = 'POST', endpoint = '', onReady?: (res: { destroyed: boolean }) => void) {
  const body = {
    appPlaylistId: `app-${caseId}`, name: '应用歌单', accountId: '7', accountToken: playbackAccountToken('cookie-a'),
    tracks: refs(['3', '1', '2']), ...(overrides.playlistId ? { expectedRevision: revision() } : {}), ...overrides,
  }
  const req = Readable.from([Buffer.from(JSON.stringify(body))]) as IncomingMessage
  req.method = method
  const res = { destroyed: false, writeHead: vi.fn(), end: vi.fn(), setHeader: vi.fn() }
  onReady?.(res)
  await appPlaylistSyncRoutes(req, res as unknown as ServerResponse, new URL(`http://localhost/api/netease/app-playlist-sync${endpoint}`), { userDataDir: 'test', port: 0 })
  return { status: res.writeHead.mock.calls[0]?.[0], body: res.end.mock.calls.length ? JSON.parse(res.end.mock.calls[0][0].toString()) : null, res }
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
  const session = await sync({}, 'GET', '/session')
  expect(session.body).toMatchObject({ accountId: '7', accountToken: expect.any(String) })
  expect(session.res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store')
  expect(await sync()).toMatchObject({ status: 200, body: { status: 'complete', success: true, playlistId: '201', report: { requested: 3, matched: 3, added: 3, removed: 0 } } })
  expect(h.call).toHaveBeenCalledWith('playlist_create', expect.objectContaining({ privacy: '10', cookie: 'cookie-a' }))
  expect(remote.ids).toEqual(['3', '1', '2'])
  expect(h.call.mock.calls.at(-1)?.[0]).toBe('playlist_detail')
})
it('快照只读返回完整歌曲引用和版本，摘要总数偏小仍以完整ID为准', async () => {
  remote.ids = Array.from({ length: 868 }, (_, i) => String(i + 1))
  h.call.mockImplementation(async (method, args) => method === 'playlist_detail'
    ? response({ playlist: { ...remote, trackCount: 862, trackIds: remote.ids.map(id => ({ id: Number(id) })) } }) : upstream(method, args))
  const result = await sync({ playlistId: '201' }, 'POST', '/snapshot')
  expect(result).toMatchObject({ status: 200, body: { name: '原歌单', tracks: refs(remote.ids), revision: revision() } })
  expect(result.res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store')
  expect(h.call).toHaveBeenCalledTimes(1)
  expect(writes()).toEqual([])
})
it('后续更新同一目标，只补增删差集并同步名称和顺序', async () => {
  remote.ids = ['9', '2', '1']
  expect((await sync({ playlistId: '201' })).body).toMatchObject({ status: 'complete', success: true, report: { added: 1, removed: 1, missingIds: [], extraIds: [], name: 'done', order: 'done' } })
  expect(h.call.mock.calls.filter(([method]) => method === 'playlist_tracks').map(([, args]) => [args.op, args.tracks])).toEqual([['add', '3'], ['del', '9']])
  expect(h.call.mock.calls.some(([method]) => method === 'playlist_create')).toBe(false)
  expect(remote.name).toBe('应用歌单')
  expect(remote.ids).toEqual(['3', '1', '2'])
})
it('相同内容不重复写入', async () => {
  remote.ids = ['3', '1', '2']; remote.name = '应用歌单'
  expect((await sync({ playlistId: '201' })).body.success).toBe(true)
  expect(writes()).toEqual([])
})
it.each([
  { tracks: [] }, { tracks: [{ source: 'qq', id: '1' }] }, { tracks: [{ source: 'apple', id: '1' }] },
  { tracks: [{ source: 'local', id: '1' }] }, { tracks: [{ source: 'netease', id: 'bad' }] },
  { tracks: [{ source: 'netease', id: '1' }, { source: 'netease', id: '1' }] }, { playlistId: 'bad' }, { name: ' ' },
  { playlistId: '201', expectedRevision: undefined }, { playlistId: '201', expectedRevision: 'old' },
])('无效或跨源输入不发上游请求 %j', async input => {
  expect((await sync(input)).status).toBe(400)
  expect(h.call).not.toHaveBeenCalled()
})
it('预期版本与云端不一致时零写并要求重新检查', async () => {
  const result = await sync({ playlistId: '201', expectedRevision: 'a'.repeat(64) })
  expect(result.body).toMatchObject({ status: 'stale', success: false, playlistId: '201', error: expect.stringContaining('变化') })
  expect(writes()).toEqual([])
  expect(h.call).toHaveBeenCalledTimes(1)
})
it.each([{ creator: { userId: 8 } }, { specialType: 5 }, { subscribed: true }])('推送与快照均拒绝非本人普通歌单 %j', async target => {
  Object.assign(remote, target)
  expect((await sync({ playlistId: '201' })).body).toMatchObject({ status: 'failed', success: false, error: expect.stringContaining('普通歌单') })
  expect((await sync({ playlistId: '201' }, 'POST', '/snapshot'))).toMatchObject({ status: 409, body: { error: expect.stringContaining('普通歌单') } })
  expect(writes()).toEqual([])
})
it.each([
  { code: 301, rejected: false }, { code: 401, rejected: false },
  { code: 301, rejected: true }, { code: 401, rejected: true },
])('上游真实鉴权失效保留401，不与歌单归属拒绝混淆 %j', async ({ code, rejected }) => {
  const payload = response({ code, message: '请重新登录' })
  if (rejected) h.call.mockRejectedValue(payload)
  else h.call.mockResolvedValue(payload)
  expect((await sync({ playlistId: '201' }, 'POST', '/snapshot'))).toMatchObject({ status: 401, body: { error: '请重新登录' } })
  expect(writes()).toEqual([])
})
it('写入期间真实鉴权失效立即终止并返回401，不继续其他步骤', async () => {
  remote.ids = ['9']
  h.call.mockImplementation(async (method, args) => method === 'playlist_tracks' ? response({ code: 301, message: '请重新登录' }) : upstream(method, args))
  expect((await sync({ playlistId: '201' }))).toMatchObject({ status: 401, body: { status: 'failed', success: false, error: '请重新登录' } })
  expect(writes()).toHaveLength(1)
})
it('旧账号凭证和错误方法不触发上游请求', async () => {
  expect((await sync({ accountId: '8' })).status).toBe(409)
  expect((await sync({ accountToken: 'old' }, 'POST', '/snapshot')).status).toBe(409)
  expect((await sync({}, 'GET')).status).toBe(405)
  expect((await sync({}, 'GET', '/snapshot')).status).toBe(405)
  expect(h.call).not.toHaveBeenCalled()
})
it('快照回查中切换Cookie后拒绝返回旧账号内容', async () => {
  h.call.mockImplementation(async (method, args) => { const result = await upstream(method, args); h.cookie.mockReturnValue('cookie-b'); return result })
  expect((await sync({ playlistId: '201' }, 'POST', '/snapshot'))).toMatchObject({ status: 409, body: { error: expect.stringContaining('账号') } })
  expect(h.call).toHaveBeenCalledTimes(1)
})
it.each([
  { trackCount: 50 },
  { trackCount: 3, trackIds: [{ id: '1' }, { id: '2' }] },
  { trackCount: 2, trackIds: [{ id: '1' }, { id: '1' }] },
  { trackCount: 1, trackIds: [{ id: '1' }, { id: 0 }] },
])('初始缺失、数量不足、重复或无效ID在任何写入前拒绝 %j', async detail => {
  h.call.mockResolvedValue(response({ playlist: { ...remote, ...detail } }))
  expect((await sync({ playlistId: '201' })).body).toMatchObject({ status: 'failed', success: false, error: expect.stringContaining('不完整') })
  expect((await sync({ playlistId: '201' }, 'POST', '/snapshot')).status).toBe(502)
  expect(writes()).toEqual([])
})
it('摘要总数偏小时仍按完整ID列表增删、排序并回读核对', async () => {
  remote.ids = ['9', '2', '1']
  h.call.mockImplementation(async (method, args) => method === 'playlist_detail'
    ? response({ playlist: { ...remote, trackCount: 1, trackIds: remote.ids.map(id => ({ id })) } }) : upstream(method, args))
  expect((await sync({ playlistId: '201' })).body.success).toBe(true)
  expect(remote.ids).toEqual(['3', '1', '2'])
})
it('新增一批失败仍继续后续批、删除和改名，并只排序实际存在子集', async () => {
  const ids = Array.from({ length: 205 }, (_, i) => String(i + 1))
  remote.ids = ['999']
  h.call.mockImplementation(async (method, args) => method === 'playlist_tracks' && args.op === 'add' && String(args.tracks).startsWith('1,')
    ? response({ code: 500, message: '首批受限' }) : upstream(method, args))
  const result = await sync({ playlistId: '201', tracks: refs(ids) })
  expect(result.body).toMatchObject({ status: 'partial', success: false, report: { requested: 205, matched: 105, added: 105, removed: 1, missingIds: ids.slice(0, 100), extraIds: [], name: 'done', order: 'done', issues: [{ step: 'add', message: '首批受限' }] } })
  const batches = h.call.mock.calls.filter(([method]) => method === 'playlist_tracks')
  expect(batches.map(([, args]) => [args.op, String(args.tracks).split(',').length])).toEqual([['add', 100], ['add', 100], ['add', 5], ['del', 1]])
  expect(remote.ids).toEqual(ids.slice(100))
  expect(remote.name).toBe('应用歌单')
  expect(h.call).toHaveBeenCalledWith('song_order_update', expect.objectContaining({ ids: JSON.stringify(ids.slice(100)) }))
})
it('删除一批失败仍继续其他批，排序把剩余额外歌曲保留在尾部', async () => {
  remote.ids = [...Array.from({ length: 205 }, (_, i) => String(i + 1000)), '2', '1']
  const retained = remote.ids.slice(0, 100)
  h.call.mockImplementation(async (method, args) => method === 'playlist_tracks' && args.op === 'del' && String(args.tracks).startsWith('1000,')
    ? response({ code: 500, message: '删除受限' }) : upstream(method, args))
  const result = await sync({ playlistId: '201' })
  expect(result.body).toMatchObject({ status: 'partial', report: { matched: 3, removed: 105, extraIds: retained.slice().reverse(), name: 'done', order: 'done', issues: [{ step: 'remove', message: '删除受限' }] } })
  expect(remote.ids).toEqual(['3', '1', '2', ...retained.slice().reverse()])
  expect(h.call.mock.calls.filter(([method, args]) => method === 'playlist_tracks' && args.op === 'del')).toHaveLength(3)
})
it('改名失败仍保留已同步歌曲与顺序，报告名称待补齐', async () => {
  remote.ids = ['9', '2', '1']
  h.call.mockImplementation(async (method, args) => method === 'playlist_name_update' ? response({ code: 500, message: '改名受限' }) : upstream(method, args))
  expect((await sync({ playlistId: '201' })).body).toMatchObject({ status: 'partial', report: { matched: 3, added: 1, removed: 1, name: 'pending', order: 'done', issues: [{ step: 'name', message: '改名受限' }] } })
  expect(remote.ids).toEqual(['3', '1', '2'])
})
it('排序前回查不完整时跳过排序，仍独立改名且最终报告真实状态', async () => {
  let reads = 0
  h.call.mockImplementation(async (method, args) => {
    if (method === 'playlist_detail' && ++reads === 2) return response({ playlist: { ...remote, trackCount: 10 } })
    return upstream(method, args)
  })
  expect((await sync({ playlistId: '201' })).body).toMatchObject({ status: 'partial', report: { matched: 3, name: 'done', order: 'pending' } })
  expect(h.call.mock.calls.some(([method]) => method === 'song_order_update')).toBe(false)
  expect(remote.name).toBe('应用歌单')
})
it.each(['network', 'incomplete'])('最终状态%s时不宣称成功，保留此前成果并报告未知', async kind => {
  let reads = 0
  h.call.mockImplementation(async (method, args) => {
    if (method === 'playlist_detail' && ++reads === 3) {
      if (kind === 'network') throw new Error('回读网络中断')
      return response({ playlist: { ...remote, trackCount: 10 } })
    }
    return upstream(method, args)
  })
  const result = await sync({ playlistId: '201' })
  expect(result.body).toMatchObject({ status: 'partial', success: false, report: { matched: null, added: null, removed: null, name: 'unknown', order: 'unknown', issues: [{ step: 'read' }] } })
  expect(result.body.snapshot).toBeUndefined()
  expect(remote.name).toBe('应用歌单')
  expect(remote.ids).toEqual(['3', '1', '2'])
})
it('重试只补上次失败差异，不重复写入已成功批次', async () => {
  const ids = Array.from({ length: 205 }, (_, i) => String(i + 1))
  let fail = true
  h.call.mockImplementation(async (method, args) => method === 'playlist_tracks' && args.op === 'add' && fail && String(args.tracks).startsWith('1,')
    ? response({ code: 500, message: '首批受限' }) : upstream(method, args))
  expect((await sync({ playlistId: '201', tracks: refs(ids) })).body.status).toBe('partial')
  fail = false
  h.call.mockClear()
  expect((await sync({ playlistId: '201', tracks: refs(ids) })).body.status).toBe('complete')
  expect(h.call.mock.calls.filter(([method]) => method === 'playlist_tracks').map(([, args]) => [args.op, args.tracks])).toEqual([['add', ids.slice(0, 100).join(',')]])
})
it('创建后失败返回目标和部分报告，重试复用检查点而不新建', async () => {
  let fail = true
  h.call.mockImplementation(async (method, args) => method === 'playlist_tracks' && fail ? response({ code: 500, message: '操作频繁' }) : upstream(method, args))
  expect((await sync()).body).toMatchObject({ status: 'partial', success: false, playlistId: '201', report: { missingIds: ['3', '1', '2'], issues: [{ step: 'add', message: '操作频繁' }] } })
  fail = false
  expect((await sync()).body.success).toBe(true)
  expect(h.call.mock.calls.filter(([method]) => method === 'playlist_create')).toHaveLength(1)
})
it('创建成功的响应丢失后重试仍复用检查点，不新建重复歌单', async () => {
  expect((await sync()).body.success).toBe(true)
  expect((await sync()).body.success).toBe(true)
  expect(h.call.mock.calls.filter(([method]) => method === 'playlist_create')).toHaveLength(1)
})
it('新增接口静默漏歌时仍删除应用不包含的歌曲，最终报告缺失', async () => {
  remote.ids = ['9']
  h.call.mockImplementation(async (method, args) => method === 'playlist_tracks' && args.op === 'add' ? response({}) : upstream(method, args))
  expect((await sync({ playlistId: '201' })).body).toMatchObject({ status: 'partial', success: false, report: { missingIds: ['3', '1', '2'], extraIds: [], removed: 1 } })
  expect(remote.ids).toEqual([])
  expect(remote.name).toBe('应用歌单')
})
it('排序未生效不能报告成功', async () => {
  remote.ids = ['2', '1', '3']
  h.call.mockImplementation(async (method, args) => method === 'song_order_update' ? response({}) : upstream(method, args))
  expect((await sync({ playlistId: '201' })).body).toMatchObject({ status: 'partial', success: false, report: { order: 'pending', name: 'done' } })
})
it.each(['playlist_tracks', 'song_order_update', 'playlist_name_update'])('步骤%s中换号立即终止，不被当作普通步骤失败继续执行', async stage => {
  remote.ids = ['9', '1', '2']
  h.call.mockImplementation(async (method, args) => {
    const result = await upstream(method, args)
    if (method === stage) h.cookie.mockReturnValue('cookie-b')
    return result
  })
  expect((await sync({ playlistId: '201' })).body).toMatchObject({ status: 'failed', success: false, playlistId: '201', error: expect.stringContaining('账号') })
  expect(h.call.mock.calls.at(-1)?.[0]).toBe(stage)
})
it('写入期间请求取消立即停止，不继续删除、排序或改名', async () => {
  remote.ids = ['9']
  let cancel!: () => void
  h.call.mockImplementation(async (method, args) => {
    const result = await upstream(method, args)
    if (method === 'playlist_tracks') cancel()
    return result
  })
  const result = await sync({ playlistId: '201' }, 'POST', '', res => { cancel = () => { res.destroyed = true } })
  expect(result.body).toMatchObject({ status: 'failed', error: expect.stringContaining('取消') })
  expect(writes().map(([method, args]) => [method, args.op])).toEqual([['playlist_tracks', 'add']])
})
it('网络请求失败同时账号变化时立即终止，不继续其他步骤', async () => {
  remote.ids = ['9']
  h.call.mockImplementation(async (method, args) => {
    if (method === 'playlist_tracks') {
      h.cookie.mockReturnValue('cookie-b')
      throw new Error('network unavailable')
    }
    return upstream(method, args)
  })
  expect((await sync({ playlistId: '201' })).body).toMatchObject({ status: 'failed', error: expect.stringContaining('账号') })
  expect(writes()).toHaveLength(1)
})
it('后续回查发现归属变化时立即停止，不再改名', async () => {
  h.call.mockImplementation(async (method, args) => {
    const result = await upstream(method, args)
    if (method === 'playlist_tracks') remote.creator.userId = 8
    return result
  })
  expect((await sync({ playlistId: '201' })).body).toMatchObject({ status: 'failed', error: expect.stringContaining('普通歌单') })
  expect(h.call.mock.calls.some(([method]) => method === 'playlist_name_update')).toBe(false)
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
it('不同应用歌单不能同时写同一云端目标', async () => {
  let release!: () => void
  h.call.mockImplementationOnce(async (method, args) => { await new Promise<void>(resolve => { release = resolve }); return upstream(method, args) })
  const first = sync({ playlistId: '201' })
  await vi.waitFor(() => expect(release).toBeTypeOf('function'))
  expect((await sync({ appPlaylistId: 'another-app', playlistId: '201' })).status).toBe(409)
  release()
  expect((await first).body.success).toBe(true)
})
it('870首歌分批添加并按完整顺序排序', async () => {
  const ids = Array.from({ length: 870 }, (_, i) => String(870 - i))
  expect((await sync({ tracks: refs(ids) })).body.success).toBe(true)
  expect(h.call.mock.calls.filter(([method]) => method === 'playlist_tracks')).toHaveLength(9)
  expect(remote.ids).toEqual(ids)
})
it('创建成功但账号切换时先保存检查点，旧账号回来重试仍复用目标', async () => {
  h.call.mockImplementation(async (method, args) => {
    const result = await upstream(method, args)
    if (method === 'playlist_create') h.cookie.mockReturnValue('cookie-b')
    return result
  })
  expect((await sync()).body).toMatchObject({ status: 'failed', success: false, playlistId: '201' })
  h.cookie.mockReturnValue('cookie-a'); h.call.mockImplementation(upstream)
  expect((await sync()).body.success).toBe(true)
  expect(h.call.mock.calls.filter(([method]) => method === 'playlist_create')).toHaveLength(1)
})
it('已经关联的歌单可手动同步为空，只清曲目不删除歌单', async () => {
  remote.ids = ['1', '2']
  expect((await sync({ playlistId: '201', tracks: [] })).body).toMatchObject({ status: 'complete', success: true, playlistId: '201' })
  expect(remote.ids).toEqual([])
  expect(h.call.mock.calls.some(([method]) => method === 'playlist_create' || method === 'playlist_delete')).toBe(false)
})
it('显式关联目标被删时返回过期，不自动新建', async () => {
  h.call.mockResolvedValue(response({ code: 404 }))
  expect((await sync({ playlistId: '201' })).body).toMatchObject({ status: 'stale', success: false, error: expect.stringContaining('已删除') })
  expect(writes()).toEqual([])
  expect((await sync({ playlistId: '201' }, 'POST', '/snapshot')).status).toBe(404)
})
it('详情网络错误不能误判删除后新建歌单', async () => {
  h.call.mockRejectedValue(new Error('network unavailable'))
  expect((await sync({ playlistId: '201' })).body).toMatchObject({ status: 'failed', success: false })
  expect(h.call).toHaveBeenCalledTimes(1)
  expect(writes()).toEqual([])
})
