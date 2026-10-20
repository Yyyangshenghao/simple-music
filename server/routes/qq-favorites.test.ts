import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { beforeEach, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ request: vi.fn(), cookie: vi.fn() }))
vi.mock('../lib/qq-playlist-write', async original => ({ ...await original<typeof import('../lib/qq-playlist-write')>(), qqPlaylistRequest: h.request }))
vi.mock('../lib/cookie', async original => ({ ...await original<typeof import('../lib/cookie')>(), getCookie: h.cookie }))
import { playbackAccountToken } from '../lib/playback-account'
import { qqFavoriteRoutes } from './qq-favorites'

const cookie = 'uin=7; qqmusic_key=fixture-key'
let liked: Record<string, boolean>
async function upstream(_cookie: string, _module: string, method: string, param: Record<string, any>) {
  if (method === 'IsSongFanByMid') return { m_fan: Object.fromEntries(param.v_songMid.map((mid: string) => [mid, liked[mid] ?? false])) }
  if (method === 'get_song_detail_yqq') return { track_info: { mid: param.song_mid, id: 123, type: 1 } }
  liked.mid1 = method === 'AddSonglist'
  return { retCode: 0 }
}
async function call(body: object = {}, check = false, method = 'POST') {
  const req = Readable.from([Buffer.from(JSON.stringify({ accountId: '7', accountToken: playbackAccountToken(cookie),
    track: { source: 'qq', id: 'mid1', qqId: '123', songType: 1 }, like: true, ...body }))]) as IncomingMessage
  req.method = method
  const res = { destroyed: false, writeHead: vi.fn(), end: vi.fn(), setHeader: vi.fn() }
  await qqFavoriteRoutes(req, res as unknown as ServerResponse, new URL(`http://localhost/api/qq/song/like${check ? '/check' : ''}`), { userDataDir: 'test', port: 0 })
  return { status: res.writeHead.mock.calls[0][0], body: JSON.parse(res.end.mock.calls[0][0].toString()) }
}
beforeEach(() => { vi.resetAllMocks(); liked = { mid1: false, mid2: true }; h.cookie.mockReturnValue(cookie); h.request.mockImplementation(upstream) })
it('批量状态按MID返回，去重且不修改收藏', async () => {
  expect((await call({ ids: ['mid1', 'mid2', 'mid1'] }, true)).body).toEqual({ success: true, liked: { mid1: false, mid2: true } })
  expect(h.request).toHaveBeenCalledTimes(1)
  expect(h.request.mock.calls[0][3]).toEqual({ v_songMid: ['mid1', 'mid2'] })
})
it('状态缺失或不是boolean不能当作未收藏', async () => {
  h.request.mockResolvedValue({ m_fan: { mid1: false } })
  expect((await call({ ids: ['mid1', 'mid2'] }, true)).body.success).toBe(false)
  h.request.mockResolvedValue({ m_fan: { mid1: 'false' } })
  expect((await call({ ids: ['mid1'] }, true)).body.success).toBe(false)
})
it('添加和取消均核实真实数字身份，并在写后检查状态', async () => {
  expect((await call()).body).toEqual({ success: true, liked: true })
  expect(h.request).toHaveBeenCalledWith(cookie, 'music.musicasset.PlaylistDetailWrite', 'AddSonglist', {
    dirId: 201, v_songInfo: [{ songId: 123, songType: 1 }],
  }, true)
  expect((await call({ like: false })).body).toEqual({ success: true, liked: false })
  expect(h.request.mock.calls.at(-1)?.[2]).toBe('IsSongFanByMid')
})
it('已是目标状态时不重复写入，也不查询曲目详情', async () => {
  liked.mid1 = true
  expect((await call()).body.success).toBe(true)
  expect(h.request).toHaveBeenCalledTimes(1)
})
it('缺失数字ID和类型的旧档在写前按MID核实', async () => {
  expect((await call({ track: { source: 'qq', id: 'mid1' } })).body.success).toBe(true)
  expect(h.request.mock.calls[1][2]).toBe('get_song_detail_yqq')
})
it.each([{ qqId: '999' }, { songType: 0 }])('数字ID或类型不一致不能修改另一首歌 %j', async changes => {
  expect((await call({ track: { source: 'qq', id: 'mid1', qqId: '123', songType: 1, ...changes } })).body.success).toBe(false)
  expect(h.request.mock.calls.some(([, , method]) => method === 'AddSonglist')).toBe(false)
})
it.each([{ track: { source: 'netease', id: 'mid1' } }, { track: { source: 'local', id: 'mid1' } },
  { track: { source: 'qq', id: 'bad-mid' } }, { like: 'true' }, { track: { source: 'qq', id: 'mid1', qqId: '9007199254740993' } }])('非法或跨源请求不调用上游 %j', async body => {
  expect((await call(body)).status).toBe(400)
  expect(h.request).not.toHaveBeenCalled()
})
it('错误会话、未登录、非POST均拒绝', async () => {
  expect((await call({ accountToken: 'old' })).status).toBe(409)
  expect((await call({}, false, 'GET')).status).toBe(405)
  h.cookie.mockReturnValue('')
  expect((await call()).status).toBe(401)
  expect(h.request).not.toHaveBeenCalled()
})
it('查询后账号变化不继续读取曲目或写入', async () => {
  h.request.mockImplementationOnce(async (cookie, module, method, param) => { const data = await upstream(cookie, module, method, param); h.cookie.mockReturnValue('uin=8; qqmusic_key=other'); return data })
  expect((await call()).body.success).toBe(false)
  expect(h.request).toHaveBeenCalledTimes(1)
})
it('接口拒绝或静默未写入不能报告成功', async () => {
  h.request.mockImplementation((cookie, module, method, param) => method === 'AddSonglist' ? Promise.reject(new Error('QQ 音乐拒绝写入（80105）')) : upstream(cookie, module, method, param))
  expect((await call()).body.error).toContain('80105')
  h.request.mockImplementation((cookie, module, method, param) => method === 'AddSonglist' ? Promise.resolve({ retCode: 0 }) : upstream(cookie, module, method, param))
  expect((await call()).body.success).toBe(false)
})
it.each([301, 1000])('明确鉴权错误%d返回401，80105保持普通失败', async code => {
  h.request.mockRejectedValueOnce(new Error(`QQ 音乐拒绝读取歌单（${code}），请稍后重试`))
  expect(await call({ ids: ['mid1'] }, true)).toEqual({ status: 401, body: { success: false, error: 'AUTH_EXPIRED' } })
})
it('2000签名要求不会被当成登录失效', async () => {
  h.request.mockRejectedValueOnce(new Error('QQ 音乐拒绝读取歌单（2000），请稍后重试'))
  expect(await call({ ids: ['mid1'] }, true)).toMatchObject({ status: 200, body: { success: false, error: expect.stringContaining('2000') } })
})
it('换号期间旧账号鉴权失败不能让新账号失效', async () => {
  h.request.mockImplementationOnce(async () => { h.cookie.mockReturnValue('uin=8; qqmusic_key=other'); throw new Error('QQ 音乐拒绝读取歌单（301）') })
  expect(await call({ ids: ['mid1'] }, true)).toEqual({ status: 409, body: { success: false, error: 'QQ 账号已变化，请重试' } })
})
it('重复请求不能释放首份写锁', async () => {
  let release!: () => void
  h.request.mockImplementationOnce(async (cookie, module, method, param) => { await new Promise<void>(resolve => { release = resolve }); return upstream(cookie, module, method, param) })
  const first = call()
  await vi.waitFor(() => expect(release).toBeTypeOf('function'))
  expect((await call()).status).toBe(409)
  expect((await call()).status).toBe(409)
  release(); expect((await first).body.success).toBe(true)
})
it.each([{ ids: [] }, { ids: ['bad-mid'] }, { ids: Array.from({ length: 101 }, () => 'mid1') }])('批量查询非法输入不请求上游 %j', async ({ ids }) => {
  expect((await call({ ids }, true)).status).toBe(400)
  expect(h.request).not.toHaveBeenCalled()
})
