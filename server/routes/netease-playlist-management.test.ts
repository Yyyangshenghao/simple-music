import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { beforeEach, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ call: vi.fn(), cookie: vi.fn(), login: vi.fn() }))
vi.mock('../lib/netease-client', async original => ({ ...await original<typeof import('../lib/netease-client')>(), call: h.call, requireLogin: h.login }))
vi.mock('../lib/cookie', async original => ({ ...await original<typeof import('../lib/cookie')>(), getCookie: h.cookie }))
import { playbackAccountToken } from '../lib/playback-account'
import { neteasePlaylistManagementRoutes } from './netease-playlist-management'

let caseId = 0
let remote: { id: string; name: string; ids: string[]; creator: { userId: number }; specialType: number; subscribed?: boolean; privacy?: number }
const refs = (ids: string[]) => ids.map(id => ({ source: 'netease', id }))
const response = (body: object) => ({ status: 200, body: { code: 200, ...body } })
const writes = () => h.call.mock.calls.filter(([method]) => method !== 'playlist_detail')
async function upstream(method: string, input: Record<string, unknown>) {
  if (method === 'playlist_detail') return response({ playlist: { ...remote, trackCount: remote.ids.length, trackIds: remote.ids.map(id => ({ id })) } })
  if (method === 'playlist_create') { remote.name = String(input.name); remote.ids = []; return response({ playlist: { id: remote.id } }) }
  if (method === 'playlist_name_update') remote.name = String(input.name)
  if (method === 'api' && input.uri === '/api/playlist/update/privacy') remote.privacy = Number((input.data as { privacy: number }).privacy)
  if (method === 'playlist_tracks') {
    const ids = String(input.tracks).split(',')
    remote.ids = input.op === 'add' ? [...new Set([...remote.ids, ...ids])] : remote.ids.filter(id => !ids.includes(id))
  }
  return response({})
}
async function manage(overrides: Record<string, unknown> = {}, method = 'POST', endpoint = '/manage', onReady?: (req: IncomingMessage, res: { destroyed: boolean }) => void) {
  const body = { action: 'add', playlistId: '201', tracks: refs(['1', '2']), accountId: '7', accountToken: playbackAccountToken('cookie-a'), ...overrides }
  const req = Readable.from([Buffer.from(JSON.stringify(body))]) as IncomingMessage
  req.method = method
  const res = { destroyed: false, writeHead: vi.fn(), end: vi.fn(), setHeader: vi.fn() }
  onReady?.(req, res)
  const handled = await neteasePlaylistManagementRoutes(req, res as unknown as ServerResponse, new URL(`http://localhost/api/netease/playlist-management${endpoint}`), { userDataDir: `test-${caseId}`, port: 0 })
  return { handled, status: res.writeHead.mock.calls[0]?.[0], body: res.end.mock.calls.length ? JSON.parse(res.end.mock.calls[0][0].toString()) : null, res }
}
beforeEach(() => {
  caseId++
  vi.resetAllMocks()
  h.login.mockResolvedValue({ userId: 7 })
  h.cookie.mockReturnValue('cookie-a')
  remote = { id: '201', name: '原歌单', ids: ['9'], creator: { userId: 7 }, specialType: 0 }
  h.call.mockImplementation(upstream)
})
it('会话不缓存，inspect 仅检查本人歌单且无写入', async () => {
  const session = await manage({}, 'GET', '/session')
  expect(session.body).toEqual({ accountId: '7', accountToken: playbackAccountToken('cookie-a') })
  expect(session.res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store')
  expect(await manage({}, 'POST', '/inspect')).toMatchObject({ status: 200, body: { playlistId: '201', name: '原歌单' } })
  expect(writes()).toEqual([])
})
it('inspect 带出可见性，切换公开与私有后回读确认，已满足时不写入', async () => {
  remote.privacy = 10
  expect((await manage({}, 'POST', '/inspect')).body).toEqual({ playlistId: '201', name: '原歌单', private: true })
  expect((await manage({ action: 'privacy', public: true })).body).toMatchObject({ playlistId: '201', status: 'complete', completed: 1 })
  expect(writes()).toEqual([['api', expect.objectContaining({ uri: '/api/playlist/update/privacy', data: { id: '201', privacy: 0 } })]])
  expect((await manage({ action: 'privacy', public: true })).body.status).toBe('complete')
  expect(writes()).toHaveLength(1)
  expect((await manage({ action: 'privacy', public: false })).body.status).toBe('complete')
  expect(remote.privacy).toBe(10)
  expect((await manage({ action: 'privacy', public: 'yes' })).status).toBe(400)
  remote.creator = { userId: 8 }
  expect((await manage({ action: 'privacy', public: true })).status).toBe(409)
  expect(writes()).toHaveLength(2)
})
it('平台静默未改可见性时报告 partial', async () => {
  remote.privacy = 10
  h.call.mockImplementation(async (method: string, input: Record<string, unknown>) => method === 'api' ? response({}) : upstream(method, input))
  expect((await manage({ action: 'privacy', public: true })).body).toMatchObject({ status: 'partial', completed: 0 })
})
it.each(['/manage', '/inspect', '/session'])('严格校验方法 %s', async endpoint => {
  expect((await manage({}, endpoint === '/session' ? 'POST' : 'GET', endpoint)).status).toBe(405)
  expect(h.call).not.toHaveBeenCalled()
  expect(h.login).not.toHaveBeenCalled()
})
it.each([
  { accountId: '8' }, { accountToken: 'old' },
])('换号凭据拒绝且无平台读写 %j', async input => {
  expect((await manage(input)).status).toBe(409)
  expect(h.call).not.toHaveBeenCalled()
})
it.each([
  { action: 'other' }, { playlistId: 'bad' }, { tracks: [] }, { tracks: refs(['1', '1']) },
  { tracks: [{ source: 'qq', id: '1' }] }, { tracks: [{ source: 'apple', id: '1' }] },
  { tracks: [{ source: 'local', id: '1' }] }, { tracks: refs(['-1']) },
  { action: 'rename', name: ' ' }, { action: 'create', name: '新歌单', requestId: '' },
])('错误参数和跨源歌曲无读写 %j', async input => {
  expect((await manage(input)).status).toBe(400)
  expect(h.call).not.toHaveBeenCalled()
})
it.each([{ creator: { userId: 8 } }, { specialType: 5 }, { subscribed: true }])('inspect 和写入拒绝非本人普通歌单 %j', async target => {
  Object.assign(remote, target)
  expect((await manage()).status).toBe(409)
  expect((await manage({}, 'POST', '/inspect')).status).toBe(409)
  expect(writes()).toEqual([])
})
it('创建空私密歌单，同一请求重试只检查已有目标', async () => {
  const input = { action: 'create', name: '新歌单', requestId: 'new-1' }
  expect((await manage(input)).body).toMatchObject({ playlistId: '201', status: 'complete', requested: 1, completed: 1 })
  expect((await manage(input)).body.status).toBe('complete')
  expect(writes()).toHaveLength(1)
  expect(writes()[0]).toEqual(['playlist_create', expect.objectContaining({ name: '新歌单', privacy: '10' })])
  expect(remote.ids).toEqual([])
  expect((await manage({ ...input, name: '另一个歌单' })).status).toBe(409)
})
it('选择公开时创建普通公开歌单，非布尔值拒绝', async () => {
  expect((await manage({ action: 'create', name: '新歌单', requestId: 'pub-1', public: true })).body).toMatchObject({ status: 'complete' })
  expect(writes()[0]).toEqual(['playlist_create', expect.objectContaining({ name: '新歌单', privacy: '0' })])
  expect((await manage({ action: 'create', name: '新歌单', requestId: 'pub-2', public: 'yes' })).status).toBe(400)
  expect(writes()).toHaveLength(1)
})
it('创建后回读失败保留目标，下次复用创建检查点', async () => {
  let fail = true
  h.call.mockImplementation(async (method, input) => {
    if (method === 'playlist_detail' && fail) throw new Error('尚未就绪')
    return upstream(method, input)
  })
  const input = { action: 'create', name: '新歌单', requestId: 'new-1' }
  expect((await manage(input)).body).toMatchObject({ playlistId: '201', status: 'unknown', completed: null })
  fail = false
  expect((await manage(input)).body.status).toBe('complete')
  expect(writes()).toHaveLength(1)
})
it('创建网络结果不明时同 requestId 不盲目再创建', async () => {
  h.call.mockRejectedValue(new Error('网络中断'))
  const input = { action: 'create', name: '新歌单', requestId: 'new-1' }
  expect((await manage(input)).body).toMatchObject({ status: 'unknown', completed: null })
  expect((await manage(input)).body).toMatchObject({ status: 'unknown', completed: null, error: expect.stringContaining('刷新') })
  expect(h.call).toHaveBeenCalledTimes(1)
})
it('改名只改名称并回读，无歌曲替换及排序', async () => {
  expect((await manage({ action: 'rename', name: '新名称' })).body).toMatchObject({ playlistId: '201', status: 'complete', requested: 1, completed: 1 })
  expect(writes()).toEqual([['playlist_name_update', expect.objectContaining({ id: '201', name: '新名称' })]])
  expect(remote.ids).toEqual(['9'])
})
it('添加与删除仅操作所选差集，不改动其他歌曲', async () => {
  remote.ids = ['9', '1']
  expect((await manage()).body).toMatchObject({ status: 'complete', requested: 2, completed: 2 })
  expect(writes()).toEqual([['playlist_tracks', expect.objectContaining({ op: 'add', tracks: '2' })]])
  expect(remote.ids).toEqual(['9', '1', '2'])
  h.call.mockClear()
  expect((await manage({ action: 'remove', tracks: refs(['1', '8']) })).body).toMatchObject({ status: 'complete', requested: 2, completed: 2 })
  expect(writes()).toEqual([['playlist_tracks', expect.objectContaining({ op: 'del', tracks: '1' })]])
  expect(remote.ids).toEqual(['9', '2'])
})
it('单批业务失败不重试，后续独立批继续，回查返回真实部分完成', async () => {
  const ids = Array.from({ length: 205 }, (_, i) => String(i + 100))
  h.call.mockImplementation(async (method, input) => method === 'playlist_tracks' && String(input.tracks).startsWith('100,')
    ? response({ code: 500, message: '首批受限' }) : upstream(method, input))
  expect((await manage({ tracks: refs(ids) })).body).toMatchObject({ status: 'partial', requested: 205, completed: 105, error: '首批受限' })
  expect(writes().map(([, input]) => String(input.tracks).split(',').length)).toEqual([100, 100, 5])
  expect(remote.ids).toEqual(['9', ...ids.slice(100)])
})
it.each(['network', 'incomplete'])('回查%s报告未知，completed 为 null', async kind => {
  let reads = 0
  h.call.mockImplementation(async (method, input) => {
    if (method === 'playlist_detail' && ++reads === 2) {
      if (kind === 'network') throw new Error('网络中断')
      return response({ playlist: { ...remote, trackCount: 10 } })
    }
    return upstream(method, input)
  })
  expect((await manage()).body).toMatchObject({ status: 'unknown', requested: 2, completed: null })
  expect(writes()).toHaveLength(1)
})
it('初始 ID 不完整时拒绝增删，不写入', async () => {
  h.call.mockResolvedValue(response({ playlist: { ...remote, trackCount: 10 } }))
  expect((await manage()).status).toBe(502)
  expect(writes()).toEqual([])
})
it.each([301, 401])('上游鉴权失效 %s 保留 HTTP 401 并停止后续批次', async code => {
  h.call.mockImplementation(async (method, input) => method === 'playlist_tracks' ? response({ code, message: '请重新登录' }) : upstream(method, input))
  expect(await manage({ tracks: refs(Array.from({ length: 205 }, (_, i) => String(i + 100))) })).toMatchObject({ status: 401, body: { status: 'unknown', completed: null, error: '请重新登录' } })
  expect(writes()).toHaveLength(1)
})
it('读取归属时换号立即停止且不返回旧账号内容', async () => {
  h.call.mockImplementation(async (method, input) => { const result = await upstream(method, input); h.cookie.mockReturnValue('cookie-b'); return result })
  expect((await manage({}, 'POST', '/inspect')).status).toBe(409)
  expect(writes()).toEqual([])
})
it('写入一批后请求取消，不继续后续批次或回读', async () => {
  let cancel = () => {}
  h.call.mockImplementation(async (method, input) => { const result = await upstream(method, input); if (method === 'playlist_tracks') cancel(); return result })
  const result = await manage({ tracks: refs(Array.from({ length: 205 }, (_, i) => String(i + 100))) }, 'POST', '/manage', (_req, res) => { cancel = () => { res.destroyed = true } })
  expect(result).toMatchObject({ status: 409, body: { status: 'unknown', completed: null } })
  expect(writes()).toHaveLength(1)
})
it('创建响应时换号保留目标，恢复原会话重试不再创建', async () => {
  let changed = false
  h.call.mockImplementation(async (method, input) => {
    const result = await upstream(method, input)
    if (method === 'playlist_create' && !changed) { changed = true; h.cookie.mockReturnValue('cookie-b') }
    return result
  })
  const input = { action: 'create', name: '新歌单', requestId: 'new-1' }
  expect(await manage(input)).toMatchObject({ status: 409, body: { playlistId: '201', status: 'unknown', completed: null } })
  h.cookie.mockReturnValue('cookie-a')
  expect((await manage(input)).body.status).toBe('complete')
  expect(writes()).toHaveLength(1)
})
it('同一目标并发写入被拒绝，首个请求结束后释放锁', async () => {
  let release = () => {}
  const waiting = new Promise<void>(resolve => { release = resolve })
  let reached = () => {}
  const entered = new Promise<void>(resolve => { reached = resolve })
  h.call.mockImplementation(async (method, input) => {
    if (method === 'playlist_tracks') { reached(); await waiting }
    return upstream(method, input)
  })
  const first = manage()
  await entered
  expect((await manage({ action: 'rename', name: '另一个名称' })).status).toBe(409)
  release()
  expect((await first).body.status).toBe('complete')
  expect((await manage({ action: 'rename', name: '新名称' })).body.status).toBe('complete')
})
it('同一创建请求并发被拒绝，只有一次上游创建', async () => {
  let release = () => {}
  const waiting = new Promise<void>(resolve => { release = resolve })
  let reached = () => {}
  const entered = new Promise<void>(resolve => { reached = resolve })
  h.call.mockImplementation(async (method, input) => {
    if (method === 'playlist_create') { reached(); await waiting }
    return upstream(method, input)
  })
  const input = { action: 'create', name: '新歌单', requestId: 'new-1' }
  const first = manage(input)
  await entered
  expect((await manage(input)).status).toBe(409)
  release()
  expect((await first).body.status).toBe('complete')
  expect(writes()).toHaveLength(1)
})

it('同账号重新登录 Cookie 更新后同 requestId 仍复用创建检查点', async () => {
  const input = { action: 'create', name: '重新登录后重试', requestId: 'same-request' }
  expect((await manage(input)).body.status).toBe('complete')
  h.cookie.mockReturnValue('cookie-b')
  expect((await manage({ ...input, accountToken: playbackAccountToken('cookie-b') })).body.status).toBe('complete')
  expect(h.call.mock.calls.filter(([name]) => name === 'playlist_create')).toHaveLength(1)
})
