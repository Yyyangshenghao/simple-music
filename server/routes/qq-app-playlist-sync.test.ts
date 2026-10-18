import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { beforeEach, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ request: vi.fn(), cookie: vi.fn() }))
vi.mock('../lib/qq-client', async original => ({ ...await original<typeof import('../lib/qq-client')>(), qqMusicRequest: h.request }))
vi.mock('../lib/cookie', async original => ({ ...await original<typeof import('../lib/cookie')>(), getCookie: h.cookie }))
import { playbackAccountToken } from '../lib/playback-account'
import { playlistSyncSnapshot } from '../lib/playlist-sync-report'
import { qqAppPlaylistSyncRoutes } from './qq-app-playlist-sync'

const cookie = 'uin=7; qqmusic_key=test-key; skey=csrf-key'
const song = (id: number, type = 0) => ({ id, type, mid: `mid${id}` })
let caseId = 0
let remote: { info: Record<string, unknown>; songs: ReturnType<typeof song>[] }
const envelope = (data: object = {}, code = 0) => ({ code: 0, playlist: { code, data } })
async function upstream(_cookie: string, payload: Record<string, any>) {
  const { method, param } = payload.playlist
  if (method === 'GetPlaylistByUin') return envelope({ v_playlist: [{ tid: remote.info.id, dirId: remote.info.dirid, uin: '7' }] })
  if (method === 'get_song_detail_yqq') {
    const id = Number(String(param.song_mid).slice(3))
    return envelope({ track_info: song(id, id === 2 ? 1 : 0) })
  }
  if (method === 'CgiGetDiss') return envelope({ code: 0, subcode: 0, dirinfo: { ...remote.info },
    total_song_num: remote.songs.length, hasmore: Number(param.song_begin + param.song_num < remote.songs.length),
    songlist: remote.songs.slice(param.song_begin, param.song_begin + param.song_num) })
  if (method === 'AddPlaylist') {
    remote.songs = []; remote.info.title = param.dirName; remote.info.dir_show = param.dirShow
    return envelope({ retCode: 0, result: { tid: 900, dirId: 51 } })
  }
  if (method === 'AddSonglist') {
    remote.songs.push(...param.v_songInfo.map((entry: { songId: number; songType: number }) => song(entry.songId, entry.songType)))
    remote.songs.reverse()
  }
  if (method === 'DelSonglist') remote.songs = remote.songs.filter(track => !param.v_songInfo.some((entry: { songId: number; songType: number }) => entry.songId === track.id && entry.songType === track.type))
  if (method === 'EditPlaylist') { remote.info.title = param.dirNewName; return envelope({}) }
  return envelope({ retCode: 0 })
}
const revision = () => playlistSyncSnapshot(String(remote.info.title), remote.songs.map(track => ({ source: 'qq', id: track.mid, qqId: String(track.id), songType: track.type }))).revision
async function sync(overrides: object = {}, method = 'POST', session: boolean | 'snapshot' = false) {
  const body = { appPlaylistId: `qq-app-${caseId}`, name: '应用歌单', accountId: '7', accountToken: playbackAccountToken(cookie),
    tracks: [3, 1, 2].map(id => ({ source: 'qq', id: `mid${id}`, qqId: String(id), songType: id === 2 ? 1 : 0 })), expectedRevision: revision(), ...overrides }
  const req = Readable.from([Buffer.from(JSON.stringify(body))]) as IncomingMessage
  req.method = method
  const res = { destroyed: false, writeHead: vi.fn(), end: vi.fn(), setHeader: vi.fn() }
  await qqAppPlaylistSyncRoutes(req, res as unknown as ServerResponse, new URL(`http://localhost/api/qq/app-playlist-sync${session === 'snapshot' ? '/snapshot' : session ? '/session' : ''}`), { userDataDir: 'test', port: 0 })
  return { status: res.writeHead.mock.calls[0]?.[0], body: res.end.mock.calls.length ? JSON.parse(res.end.mock.calls[0][0].toString()) : null }
}
const writes = () => h.request.mock.calls.map(([, payload]) => payload.playlist).filter(block => block.module.endsWith('Write'))
beforeEach(() => {
  caseId++
  vi.resetAllMocks()
  h.cookie.mockReturnValue(cookie)
  remote = { info: { id: 900, dirid: 51, creator: { musicid: 7 }, owndir: 1, title: '原歌单', dir_show: 2,
    desc: '保留简介', picurl: 'https://y.qq.com/cover.jpg', picurl2: '', tag: [], vec_tagid: [3, 5] }, songs: [] }
  h.request.mockImplementation(upstream)
})
it('账号会话不泄露 Cookie，创建私密歌单并使用数字歌曲 ID/类型读回校验', async () => {
  const session = await sync({}, 'GET', true)
  expect(session.body).toEqual({ accountId: '7', accountToken: playbackAccountToken(cookie) })
  expect(JSON.stringify(session)).not.toContain('test-key')
  expect((await sync()).body).toMatchObject({ success: true, status: 'complete', playlistId: '900', report: { order: 'unsupported' } })
  expect(writes()[0]).toMatchObject({ method: 'AddPlaylist', param: { dirShow: 2 } })
  expect(writes()[1]).toMatchObject({ method: 'AddSonglist', param: { dirId: 51, tid: 900, bFmtUtf8: true,
    v_songInfo: [{ songId: 3, songType: 0 }, { songId: 1, songType: 0 }, { songId: 2, songType: 1 }] } })
  expect(remote.songs.map(track => track.id)).not.toEqual([3, 1, 2])
  const hash = (key: string) => { let value = 5381; for (const char of key) value += (value << 5) + char.charCodeAt(0); return value & 0x7fffffff }
  expect(h.request.mock.calls[0][1].comm).toMatchObject({ ct: 24, cv: 4747474, g_tk: hash('csrf-key'), g_tk_new_20200303: hash('test-key'), needNewCode: 1 })
})
it('同步名称和歌曲差集，完整保留简介、封面、标签、可见性，不清空排序', async () => {
  remote.songs = [song(9), song(1), song(2, 1)]
  expect((await sync({ playlistId: '900' })).body.success).toBe(true)
  expect(writes()).toMatchObject([
    { method: 'AddSonglist', param: { v_songInfo: [{ songId: 3 }] } },
    { method: 'DelSonglist', param: { v_songInfo: [{ songId: 9 }] } },
    { method: 'EditPlaylist', param: { dirId: 51, mask: 95, dirNewName: '应用歌单', dirNewDesc: '保留简介',
      dirNewPicUrl: 'https://y.qq.com/cover.jpg', dirNewPicUrl2: '', dirNewtaglist: '3,5', dirShow: 2 } },
  ])
})
it('相同名称和歌曲即使顺序不同也不写入', async () => {
  remote.info.title = '应用歌单'; remote.songs = [song(1), song(2, 1), song(3)]
  expect((await sync({ playlistId: '900' })).body.success).toBe(true)
  expect(writes()).toEqual([])
})
it.each([
  { tracks: [] }, { name: '名'.repeat(21) }, { tracks: [{ source: 'netease', id: '1', qqId: '1', songType: 0 }] },
  { tracks: [{ source: 'local', id: '1', qqId: '1', songType: 0 }] },
  { tracks: [{ source: 'qq', id: 'mid1', qqId: 'mid1', songType: 0 }] },
  { tracks: [{ source: 'qq', id: 'mid1', qqId: '9007199254740993', songType: 0 }] },
  { tracks: [{ source: 'qq', id: 'mid1', qqId: '1', songType: -1 }] },
  { playlistId: 'qq-liked:201' }, { playlistId: 'qq-toplist:3' },
])('不合法输入不访问上游 %j', async input => {
  expect((await sync(input)).status).toBe(400)
  expect(h.request).not.toHaveBeenCalled()
})
it.each([{ creator: { musicid: 8 } }, { owndir: 0 }, { dirid: 201 }, { dirid: 206 }, { id: 901 }])('拒绝非本人普通歌单 %j', async changes => {
  Object.assign(remote.info, changes)
  expect((await sync({ playlistId: '900' })).body.error).toContain('普通歌单')
  expect(writes()).toEqual([])
})
it.each(['outer', 'block', 'retCode'] as const)('检查 %s 错误码，80105不能伪报成功', async level => {
  h.request.mockResolvedValue(level === 'outer' ? { code: 80105, playlist: { code: 0, data: { retCode: 0 } } }
    : level === 'block' ? envelope({ retCode: 0 }, 80105) : envelope({ retCode: 80105 }))
  expect((await sync()).body).toMatchObject({ success: false, error: expect.stringContaining('80105') })
})
it('旧账号、未登录、非POST不触发任何写入', async () => {
  expect((await sync({ accountToken: 'old' })).status).toBe(409)
  expect((await sync({ accountId: '8' })).status).toBe(409)
  expect((await sync({}, 'GET')).status).toBe(405)
  h.cookie.mockReturnValue('')
  expect((await sync()).status).toBe(401)
  expect(h.request).not.toHaveBeenCalled()
})
it('创建成功但响应期间账号变化，先保留检查点，回来重试不重复创建', async () => {
  h.request.mockImplementation(async (cookie, payload) => {
    const result = await upstream(cookie, payload)
    if (payload.playlist.method === 'AddPlaylist') h.cookie.mockReturnValue('uin=8; qqmusic_key=other')
    return result
  })
  expect((await sync()).body).toMatchObject({ success: false, playlistId: '900' })
  h.cookie.mockReturnValue(cookie); h.request.mockImplementation(upstream)
  expect((await sync()).body.success).toBe(true)
  expect(writes().filter(block => block.method === 'AddPlaylist')).toHaveLength(1)
})
it('首次完整同步回执丢失后，不带目标ID重试仍复用已创建歌单', async () => {
  expect((await sync()).body.status).toBe('complete')
  // 客户端未收到首次回执，因此重试仍只有原应用歌单 ID。
  expect((await sync()).body).toMatchObject({ success: true, status: 'complete', playlistId: '900' })
  expect(writes().filter(block => block.method === 'AddPlaylist')).toHaveLength(1)
  expect(writes().filter(block => block.method === 'AddSonglist')).toHaveLength(1)
})
it('新增静默漏歌仍删除明确差集并改名，报告最终缺失歌曲', async () => {
  remote.songs = [song(9)]
  h.request.mockImplementation((cookie, payload) => payload.playlist.method === 'AddSonglist' ? envelope({ retCode: 0 }) : upstream(cookie, payload))
  expect((await sync({ playlistId: '900' })).body).toMatchObject({ success: false, status: 'partial', playlistId: '900',
    report: { matched: 0, removed: 1, missingIds: ['mid3', 'mid1', 'mid2'], extraIds: [], name: 'done' } })
  expect(remote.songs).toEqual([])
  expect(writes().map(block => block.method)).toEqual(['AddSonglist', 'DelSonglist', 'EditPlaylist'])
})
it('改名静默失败不能标记成功，缺少标签信息时不冒险编辑', async () => {
  remote.songs = [song(3), song(1), song(2, 1)]
  h.request.mockImplementation((cookie, payload) => payload.playlist.method === 'EditPlaylist' ? envelope({ retCode: 0 }) : upstream(cookie, payload))
  expect((await sync({ playlistId: '900' })).body.success).toBe(false)
  delete remote.info.vec_tagid
  h.request.mockClear()
  expect((await sync({ playlistId: '900' })).body.report.issues).toContainEqual({ step: 'name', message: expect.stringContaining('信息不完整') })
  expect(writes()).toEqual([])
})
it('870首完整分页、100首分批写入，不误认第一页为全量', async () => {
  const tracks = Array.from({ length: 870 }, (_, index) => ({ source: 'qq', id: `mid${index + 1}`, qqId: String(index + 1), songType: 0 }))
  expect((await sync({ tracks })).body.success).toBe(true)
  expect(writes().filter(block => block.method === 'AddSonglist')).toHaveLength(9)
  expect(remote.songs).toHaveLength(870)
})
it('分页列表不完整或网络失败不能删除旧歌，也不能误判歌单删除后新建', async () => {
  h.request.mockImplementation((cookie, payload) => payload.playlist.method === 'CgiGetDiss'
    ? envelope({ dirinfo: remote.info, total_song_num: 870, songlist: [song(1)], hasmore: 0 }) : upstream(cookie, payload))
  expect((await sync({ playlistId: '900' })).body.error).toContain('不完整')
  expect(h.request.mock.calls.some(([, payload]) => payload.playlist.method === 'CgiGetDiss')).toBe(true)
  expect(writes()).toEqual([])
  h.request.mockRejectedValue(new Error('network unavailable'))
  expect((await sync({ playlistId: '900' })).body.success).toBe(false)
  expect(writes()).toEqual([])
})
it('已经关联的歌单可手动更新为空，保留歌单本身', async () => {
  remote.songs = [song(1), song(2)]
  expect((await sync({ playlistId: '900', tracks: [] })).body.success).toBe(true)
  expect(remote.songs).toEqual([])
  expect(writes().some(block => ['AddPlaylist', 'DelPlaylist'].includes(block.method))).toBe(false)
})
it('未确认私密的新歌单不写歌曲，重试也不能绕过可见性检查', async () => {
  h.request.mockImplementation(async (cookie, payload) => {
    const result = await upstream(cookie, payload)
    if (payload.playlist.method === 'AddPlaylist') remote.info.dir_show = 1
    return result
  })
  expect((await sync()).body.error).toContain('私密')
  expect((await sync({ playlistId: '900' })).body.error).toContain('私密')
  expect(writes().filter(block => block.method !== 'AddPlaylist')).toEqual([])
})
it('重复请求不能提前释放原写锁', async () => {
  let release!: () => void
  h.request.mockImplementationOnce(async (cookie, payload) => { await new Promise<void>(resolve => { release = resolve }); return upstream(cookie, payload) })
  const first = sync({ playlistId: '900' })
  await vi.waitFor(() => expect(release).toBeTypeOf('function'))
  expect((await sync({ playlistId: '900' })).status).toBe(409)
  expect((await sync({ playlistId: '900' })).status).toBe(409)
  release()
  expect((await first).body.success).toBe(true)
})
it('不同应用歌单指向同一云端目标也串行写入，拒绝请求不能释放原目标锁', async () => {
  let release!: () => void
  h.request.mockImplementationOnce(async (cookie, payload) => { await new Promise<void>(resolve => { release = resolve }); return upstream(cookie, payload) })
  const first = sync({ playlistId: '900' })
  await vi.waitFor(() => expect(release).toBeTypeOf('function'))
  const initialCalls = h.request.mock.calls.length
  expect((await sync({ appPlaylistId: `other-${caseId}`, playlistId: '900' })).status).toBe(409)
  expect((await sync({ appPlaylistId: `third-${caseId}`, playlistId: '900' })).status).toBe(409)
  expect(h.request).toHaveBeenCalledTimes(initialCalls)
  release()
  expect((await first).body.success).toBe(true)
  expect((await sync({ appPlaylistId: `other-${caseId}`, playlistId: '900' })).body.success).toBe(true)
})
it('首次创建取得目标ID后立即占用目标锁，完成后释放', async () => {
  let release!: () => void
  h.request.mockImplementation(async (cookie, payload) => {
    if (payload.playlist.method === 'AddSonglist') await new Promise<void>(resolve => { release = resolve })
    return upstream(cookie, payload)
  })
  const first = sync()
  await vi.waitFor(() => expect(release).toBeTypeOf('function'))
  const initialCalls = h.request.mock.calls.length
  expect((await sync({ appPlaylistId: `other-${caseId}`, playlistId: '900' })).status).toBe(409)
  expect(h.request).toHaveBeenCalledTimes(initialCalls)
  release()
  expect((await first).body.success).toBe(true)
  h.request.mockImplementation(upstream)
  expect((await sync({ appPlaylistId: `other-${caseId}`, playlistId: '900' })).body.success).toBe(true)
})
it('旧档未知类型先查MID并核对数字ID，保留非0类型后才创建写入', async () => {
  const tracks = [1, 2].map(id => ({ source: 'qq', id: `mid${id}`, qqId: String(id) }))
  expect((await sync({ tracks })).body.success).toBe(true)
  const methods = h.request.mock.calls.map(([, payload]) => payload.playlist.method)
  expect(methods.slice(0, 2)).toEqual(['get_song_detail_yqq', 'get_song_detail_yqq'])
  expect(writes().find(block => block.method === 'AddSonglist').param.v_songInfo).toEqual([{ songId: 1, songType: 0 }, { songId: 2, songType: 1 }])
})
it('旧档身份核实失败时不创建歌单、不写入歌曲', async () => {
  h.request.mockResolvedValue(envelope({ track_info: song(2, 1) }))
  expect((await sync({ tracks: [{ source: 'qq', id: 'mid1', qqId: '1' }] })).body.error).toContain('身份不一致')
  expect(h.request.mock.calls.every(([, payload]) => payload.playlist.method === 'get_song_detail_yqq')).toBe(true)
})
it('无创建缓存的已关联公开歌单同样拒绝写入，重启不能绕过私密要求', async () => {
  remote.info.dir_show = 1
  expect((await sync({ playlistId: '900' })).body.error).toContain('私密')
  expect(writes()).toEqual([])
})
it('无新增但MID和数字身份冲突时，不得先删除旧歌', async () => {
  remote.songs = [song(1), song(9)]
  expect((await sync({ playlistId: '900', tracks: [{ source: 'qq', id: 'wrongMid', qqId: '1', songType: 0 }] })).body.error).toContain('身份不一致')
  expect(writes()).toEqual([])
  expect(remote.songs).toEqual([song(1), song(9)])
})
it('私密详情隐藏创建者ID时，当前账号清单与本人标记共同确认归属', async () => {
  remote.info.creator = { musicid: 0 }
  remote.info.host_uin = 0
  expect((await sync()).body).toMatchObject({ success: true, status: 'complete', playlistId: '900' })
  expect(writes().find(block => block.method === 'AddSonglist')).toBeDefined()
})
it.each([
  { entries: [] }, { entries: [{ tid: 900, dirId: 51, uin: '8' }] }, { entries: [{ tid: 900, dirId: 52, uin: '7' }] },
  { entries: [{ tid: 900, dirId: 51, uin: '7' }, { tid: 900, dirId: 51, uin: '7' }] },
])('详情隐藏身份也不能绕过清单中的账号、唯一目标及目录核对 %j', async ({ entries }) => {
  remote.info.creator = { musicid: 0 }
  h.request.mockImplementation((cookie, payload) => payload.playlist.method === 'GetPlaylistByUin' ? envelope({ v_playlist: entries }) : upstream(cookie, payload))
  expect((await sync({ playlistId: '900' })).body.success).toBe(false)
  expect(writes()).toEqual([])
})
it('账号在歌单清单响应期间变化时，不继续读取详情或写入', async () => {
  h.request.mockImplementation(async (cookie, payload) => {
    const result = await upstream(cookie, payload)
    if (payload.playlist.method === 'GetPlaylistByUin') h.cookie.mockReturnValue('uin=8; qqmusic_key=other')
    return result
  })
  expect((await sync({ playlistId: '900' })).body.error).toContain('账号已变化')
  expect(h.request.mock.calls.map(([, payload]) => payload.playlist.method)).toEqual(['GetPlaylistByUin'])
})
it('清单归属成立但隐藏ID的详情没有本人标记时也不写入', async () => {
  remote.info.creator = { musicid: 0 }; remote.info.owndir = 0
  expect((await sync({ playlistId: '900' })).body.success).toBe(false)
  expect(writes()).toEqual([])
})
it('快照读取完整分页并返回真实类型与稳定版本，不写入云端', async () => {
  remote.songs = Array.from({ length: 205 }, (_, index) => song(index + 1, index % 3))
  const result = await sync({ playlistId: '900' }, 'POST', 'snapshot')
  expect(result.status).toBe(200)
  expect(result.body).toMatchObject({ name: '原歌单', revision: revision() })
  expect(result.body.tracks).toHaveLength(205)
  expect(result.body.tracks[204]).toEqual({ source: 'qq', id: 'mid205', qqId: '205', songType: 0 })
  expect(h.request.mock.calls.filter(([, payload]) => payload.playlist.method === 'CgiGetDiss').map(([, payload]) => payload.playlist.param.song_begin)).toEqual([0, 100, 200])
  expect(writes()).toEqual([])
})
it.each([{ creator: { musicid: 8 } }, { owndir: 0 }, { dirid: 201 }, { dir_show: 1 }])('快照保留本人、普通和私密限制 %j', async changes => {
  Object.assign(remote.info, changes)
  expect((await sync({ playlistId: '900' }, 'POST', 'snapshot')).status).toBe(409)
  expect(writes()).toEqual([])
})
it.each([301, 1000])('快照真正鉴权错误%d返回401，业务拒绝保持409', async code => {
  h.request.mockResolvedValue(envelope({}, code))
  expect((await sync({ playlistId: '900' }, 'POST', 'snapshot')).status).toBe(401)
  expect(writes()).toEqual([])
})
it('快照普通业务错误不会将账号标记失效', async () => {
  h.request.mockResolvedValue(envelope({}, 80105))
  expect((await sync({ playlistId: '900' }, 'POST', 'snapshot')).status).toBe(502)
  expect(writes()).toEqual([])
})
it('快照不接受缺页、过期会话或错误请求方法', async () => {
  h.request.mockImplementation((cookie, payload) => payload.playlist.method === 'CgiGetDiss'
    ? envelope({ dirinfo: remote.info, total_song_num: 205, songlist: [song(1)], hasmore: 0 }) : upstream(cookie, payload))
  expect((await sync({ playlistId: '900' }, 'POST', 'snapshot')).status).toBe(502)
  h.request.mockClear()
  expect((await sync({ playlistId: '900', accountToken: 'old' }, 'POST', 'snapshot')).status).toBe(409)
  expect((await sync({ playlistId: '900' }, 'GET', 'snapshot')).status).toBe(405)
  expect(h.request).not.toHaveBeenCalled()
})
it.each([undefined, '', 'old', 'a'.repeat(63), 'g'.repeat(64)])('已有目标必须携带有效版本 %j', async expectedRevision => {
  expect((await sync({ playlistId: '900', expectedRevision })).status).toBe(400)
  expect(h.request).not.toHaveBeenCalled()
})
it('名称、歌曲或顺序版本变化均返回stale，零写入', async () => {
  remote.songs = [song(1), song(2, 1)]
  const expectedRevision = revision()
  remote.songs.reverse()
  const result = await sync({ playlistId: '900', expectedRevision })
  expect(result.body).toMatchObject({ status: 'stale', success: false, snapshot: { revision: revision() } })
  expect(writes()).toEqual([])
})
it('失败批次不重发，其余新增批次、删除和改名继续，重试只补剩余差集', async () => {
  const tracks = Array.from({ length: 205 }, (_, index) => ({ source: 'qq', id: `mid${index + 1}`, qqId: String(index + 1), songType: 0 }))
  remote.songs = [song(999)]
  let batches = 0
  h.request.mockImplementation((cookie, payload) => {
    if (payload.playlist.method === 'AddSonglist' && ++batches === 1) return envelope({ retCode: 80105 })
    return upstream(cookie, payload)
  })
  const result = await sync({ playlistId: '900', tracks })
  expect(result.body).toMatchObject({ success: false, status: 'partial',
    report: { requested: 205, matched: 105, added: 105, removed: 1, extraIds: [], name: 'done', order: 'unsupported',
      issues: [{ step: 'add', message: expect.stringContaining('80105') }] } })
  expect(result.body.report.missingIds).toHaveLength(100)
  expect(writes().filter(block => block.method === 'AddSonglist')).toHaveLength(3)
  expect(writes().slice(-2).map(block => block.method)).toEqual(['DelSonglist', 'EditPlaylist'])
  h.request.mockClear(); h.request.mockImplementation(upstream)
  expect((await sync({ playlistId: '900', tracks })).body.status).toBe('complete')
  expect(writes()).toMatchObject([{ method: 'AddSonglist', param: { v_songInfo: Array.from({ length: 100 }, (_, index) => ({ songId: index + 1, songType: 0 })) } }])
})
it('删除某批失败仍执行其他删除批次及改名，报告额外歌曲', async () => {
  remote.songs = Array.from({ length: 205 }, (_, index) => song(index + 1))
  let batches = 0
  h.request.mockImplementation((cookie, payload) => {
    if (payload.playlist.method === 'DelSonglist' && ++batches === 1) throw new Error('network unavailable')
    return upstream(cookie, payload)
  })
  const result = await sync({ playlistId: '900', tracks: [] })
  expect(result.body).toMatchObject({ status: 'partial', report: { removed: 105, name: 'done', issues: [{ step: 'remove', message: 'network unavailable' }] } })
  expect(result.body.report.extraIds).toHaveLength(100)
  expect(writes().filter(block => block.method === 'DelSonglist')).toHaveLength(3)
  expect(writes().at(-1).method).toBe('EditPlaylist')
})
it('旧类型核实普通失败仅跳过该曲，不误删希望保留的MID，其余步骤继续', async () => {
  remote.songs = [song(1), song(9)]
  h.request.mockImplementation((cookie, payload) => payload.playlist.method === 'get_song_detail_yqq'
    ? Promise.reject(new Error('track unavailable')) : upstream(cookie, payload))
  const result = await sync({ playlistId: '900', tracks: [
    { source: 'qq', id: 'mid1', qqId: '1' }, { source: 'qq', id: 'mid2', qqId: '2' },
    { source: 'qq', id: 'mid3', qqId: '3', songType: 0 },
  ] })
  expect(result.body).toMatchObject({ status: 'partial', report: { missingIds: ['mid2'], extraIds: [], added: 1, removed: 1, name: 'done' } })
  expect(remote.songs).toContainEqual(song(1))
  expect(writes()).toMatchObject([
    { method: 'AddSonglist', param: { v_songInfo: [{ songId: 3, songType: 0 }] } },
    { method: 'DelSonglist', param: { v_songInfo: [{ songId: 9, songType: 0 }] } },
    { method: 'EditPlaylist' },
  ])
})
it('旧类型核实结果与已存在MID类型冲突时拒绝任何写入', async () => {
  remote.songs = [song(2, 0), song(9)]
  expect((await sync({ playlistId: '900', tracks: [{ source: 'qq', id: 'mid2', qqId: '2' }] })).body.error).toContain('身份不一致')
  expect(writes()).toEqual([])
})
it('改名保留歌曲步骤后最新的完整元数据', async () => {
  h.request.mockImplementation(async (cookie, payload) => {
    const result = await upstream(cookie, payload)
    if (payload.playlist.method === 'AddSonglist') Object.assign(remote.info, { desc: '刚修改的简介', picurl: 'https://y.qq.com/new.jpg', picurl2: 'https://y.qq.com/second.jpg', vec_tagid: [8] })
    return result
  })
  expect((await sync({ playlistId: '900' })).body.status).toBe('complete')
  expect(writes().find(block => block.method === 'EditPlaylist').param).toMatchObject({
    dirNewDesc: '刚修改的简介', dirNewPicUrl: 'https://y.qq.com/new.jpg', dirNewPicUrl2: 'https://y.qq.com/second.jpg', dirNewtaglist: '8', dirShow: 2,
  })
})
it('最终读回失败报告unknown，不用中间快照伪报成功', async () => {
  let reads = 0
  h.request.mockImplementation((cookie, payload) => {
    if (payload.playlist.method === 'CgiGetDiss' && ++reads === 3) throw new Error('final read unavailable')
    return upstream(cookie, payload)
  })
  const result = await sync({ playlistId: '900' })
  expect(result.body).toMatchObject({ status: 'partial', success: false, report: { matched: null, added: null, removed: null, name: 'unknown', order: 'unsupported', issues: [{ step: 'read', message: 'final read unavailable' }] } })
  expect(result.body.snapshot).toBeUndefined()
  expect(remote.info.title).toBe('应用歌单')
})
it('后续歌曲列表暂不可读，完整且重新核实归属的元数据仍可独立改名', async () => {
  let reads = 0
  h.request.mockImplementation((cookie, payload) => {
    if (payload.playlist.method === 'CgiGetDiss') {
      reads++
      if (reads === 2) return envelope({ dirinfo: { ...remote.info } })
      if (reads === 3) throw new Error('songs unavailable')
    }
    return upstream(cookie, payload)
  })
  expect((await sync({ playlistId: '900' })).body).toMatchObject({ status: 'partial', report: { name: 'unknown' } })
  expect(writes().at(-1).method).toBe('EditPlaylist')
  expect(remote.info.title).toBe('应用歌单')
})
it.each([301, 1000])('加歌遇到鉴权错误%d立即停止删除和改名', async code => {
  remote.songs = [song(9)]
  h.request.mockImplementation((cookie, payload) => payload.playlist.method === 'AddSonglist' ? envelope({ retCode: code }) : upstream(cookie, payload))
  const result = await sync({ playlistId: '900' })
  expect(result.status).toBe(401)
  expect(result.body).toMatchObject({ success: false, status: 'partial', playlistId: '900', error: expect.stringContaining(String(code)) })
  expect(writes().map(block => block.method)).toEqual(['AddSonglist'])
  expect(remote.songs).toEqual([song(9)])
})
it.each([301, 1000])('初始读取鉴权错误%d返回401及failed，零写入', async code => {
  h.request.mockResolvedValue(envelope({}, code))
  const result = await sync({ playlistId: '900' })
  expect(result.status).toBe(401)
  expect(result.body).toMatchObject({ success: false, status: 'failed', playlistId: '900', error: expect.stringContaining(String(code)) })
  expect(writes()).toEqual([])
})
it('创建后的鉴权错误保留检查点，恢复登录重试不重复创建', async () => {
  h.request.mockImplementation((cookie, payload) => payload.playlist.method === 'AddSonglist' ? envelope({ retCode: 301 }) : upstream(cookie, payload))
  const result = await sync()
  expect(result.status).toBe(401)
  expect(result.body).toMatchObject({ success: false, status: 'partial', playlistId: '900' })
  h.request.mockImplementation(upstream)
  expect((await sync()).body.success).toBe(true)
  expect(writes().filter(block => block.method === 'AddPlaylist')).toHaveLength(1)
})
it('推送业务归属拒绝返回409，避免误使账号过期', async () => {
  remote.info.creator = { musicid: 8 }
  const result = await sync({ playlistId: '900' })
  expect(result.status).toBe(409)
  expect(result.body).toMatchObject({ success: false, status: 'failed', playlistId: '900' })
  expect(writes()).toEqual([])
})
it('加歌后账号变化立即停止后续写入', async () => {
  remote.songs = [song(9)]
  h.request.mockImplementation(async (cookie, payload) => {
    const result = await upstream(cookie, payload)
    if (payload.playlist.method === 'AddSonglist') h.cookie.mockReturnValue('uin=8; qqmusic_key=other')
    return result
  })
  expect((await sync({ playlistId: '900' })).body.error).toContain('账号已变化')
  expect(writes().map(block => block.method)).toEqual(['AddSonglist'])
})

it('播放权限字段不改变完整引用，仍收录的不可播歌曲不会成为删除差集', async () => {
  remote.songs = [song(3), song(1), song(2, 1)]; remote.info.title = '应用歌单'
  h.request.mockImplementation(async (cookie, payload) => {
    const result = await upstream(cookie, payload)
    if (payload.playlist.method === 'CgiGetDiss') {
      return envelope({ ...result.playlist.data, songlist: remote.songs.map(track => ({ ...track, action: { switch: 0 }, pay: { pay_play: 1 } })) })
    }
    return result
  })
  expect((await sync({ playlistId: '900' }, 'POST', 'snapshot')).body.tracks).toEqual([
    { source: 'qq', id: 'mid3', qqId: '3', songType: 0 },
    { source: 'qq', id: 'mid1', qqId: '1', songType: 0 },
    { source: 'qq', id: 'mid2', qqId: '2', songType: 1 },
  ])
  expect((await sync({ playlistId: '900' })).body).toMatchObject({ status: 'complete', report: { matched: 3, added: 0, removed: 0 } })
  expect(writes()).toEqual([])
})

it.each(['total', 'duplicate', 'identity'] as const)('分页中途%s变化时不接受混合快照，不删除歌曲', async kind => {
  remote.songs = Array.from({ length: 101 }, (_, index) => song(index + 1))
  h.request.mockImplementation(async (cookie, payload) => {
    const result = await upstream(cookie, payload)
    if (payload.playlist.method === 'CgiGetDiss' && payload.playlist.param.song_begin === 100) {
      const data = result.playlist.data as Record<string, unknown>
      if (kind === 'total') data.total_song_num = 102
      if (kind === 'duplicate') data.songlist = [song(1)]
      if (kind === 'identity') data.songlist = [{ ...song(101), mid: '' }]
    }
    return result
  })
  expect((await sync({ playlistId: '900' }, 'POST', 'snapshot')).status).toBe(502)
  expect((await sync({ playlistId: '900' })).body.success).toBe(false)
  expect(writes()).toEqual([])
  expect(remote.songs).toHaveLength(101)
})

it('10001首超过单次同步上限时不创建也不读取上游', async () => {
  const tracks = Array.from({ length: 10001 }, (_, index) => ({ source: 'qq', id: `mid${index + 1}`, qqId: String(index + 1), songType: 0 }))
  expect((await sync({ tracks })).status).toBe(400)
  expect(h.request).not.toHaveBeenCalled()
})

it('恰好10000首可读完第100页且幂等同步，不被页数上限误拒', async () => {
  remote.songs = Array.from({ length: 10000 }, (_, index) => song(index + 1)); remote.info.title = '应用歌单'
  const tracks = remote.songs.map(track => ({ source: 'qq', id: track.mid, qqId: String(track.id), songType: track.type }))
  expect((await sync({ playlistId: '900' }, 'POST', 'snapshot')).body.tracks).toHaveLength(10000)
  expect((await sync({ playlistId: '900', tracks })).body).toMatchObject({ status: 'complete', report: { requested: 10000, matched: 10000, order: 'unsupported' } })
  expect(writes()).toEqual([])
  expect(h.request.mock.calls.some(([, payload]) => payload.playlist.method === 'CgiGetDiss' && payload.playlist.param.song_begin === 9900)).toBe(true)
})
