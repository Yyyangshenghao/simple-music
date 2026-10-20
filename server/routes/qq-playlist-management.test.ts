import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { beforeEach, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ request: vi.fn(), cookie: vi.fn() }))
vi.mock('../lib/qq-client', async original => ({ ...await original<typeof import('../lib/qq-client')>(), qqMusicRequest: h.request }))
vi.mock('../lib/cookie', async original => ({ ...await original<typeof import('../lib/cookie')>(), getCookie: h.cookie }))
import { playbackAccountToken } from '../lib/playback-account'
import { qqPlaylistManagementRoutes } from './qq-playlist-management'

const cookie = 'uin=7; qqmusic_key=test-key; skey=csrf-key'
const song = (id: number, type = id === 2 ? 1 : 0) => ({ id, type, mid: `mid${id}` })
let caseId = 0
let remote: { info: Record<string, unknown>; songs: ReturnType<typeof song>[] }
const envelope = (data: object = {}, code = 0) => ({ code: 0, playlist: { code, data } })
async function upstream(_cookie: string, payload: Record<string, any>) {
  const { method, param } = payload.playlist
  if (method === 'GetPlaylistByUin') return envelope({ v_playlist: [{ tid: remote.info.id, dirId: remote.info.dirid, uin: '7' }] })
  if (method === 'get_song_detail_yqq') return envelope({ track_info: song(Number(String(param.song_mid).slice(3))) })
  if (method === 'CgiGetDiss') return envelope({ dirinfo: { ...remote.info }, total_song_num: remote.songs.length,
    hasmore: Number(param.song_begin + param.song_num < remote.songs.length), songlist: remote.songs.slice(param.song_begin, param.song_begin + param.song_num) })
  if (method === 'AddPlaylist') { remote.songs = []; remote.info.title = param.dirName; remote.info.dir_show = param.dirShow; return envelope({ retCode: 0, result: { tid: 900, dirId: 51 } }) }
  if (method === 'AddSonglist') remote.songs.push(...param.v_songInfo.map((entry: { songId: number; songType: number }) => song(entry.songId, entry.songType)))
  if (method === 'DelSonglist') remote.songs = remote.songs.filter(track => !param.v_songInfo.some((entry: { songId: number; songType: number }) => entry.songId === track.id && entry.songType === track.type))
  if (method === 'EditPlaylist') { remote.info.title = param.dirNewName; return envelope({}) }
  return envelope({ retCode: 0 })
}
const tracks = (...ids: number[]) => ids.map(id => ({ source: 'qq', id: `mid${id}`, qqId: String(id), songType: id === 2 ? 1 : 0 }))
async function manage(overrides: object = {}, path = 'manage', method = path === 'session' ? 'GET' : 'POST', setup?: (req: IncomingMessage) => void) {
  const body = { action: 'add', playlistId: '900', tracks: tracks(1, 2), requestId: `create-${caseId}`, name: '新名称',
    accountId: '7', accountToken: playbackAccountToken(cookie), ...overrides }
  const req = Readable.from([Buffer.from(JSON.stringify(body))]) as IncomingMessage
  req.method = method
  setup?.(req)
  const res = { destroyed: false, writeHead: vi.fn(), end: vi.fn(), setHeader: vi.fn() }
  await qqPlaylistManagementRoutes(req, res as unknown as ServerResponse, new URL(`http://localhost/api/qq/playlist-management/${path}`), { userDataDir: 'test', port: 0 })
  return { status: res.writeHead.mock.calls[0]?.[0], body: res.end.mock.calls.length ? JSON.parse(res.end.mock.calls[0][0].toString()) : null }
}
const writes = () => h.request.mock.calls.map(([, payload]) => payload.playlist).filter(block => block.module.endsWith('Write'))
beforeEach(() => {
  caseId++
  vi.resetAllMocks()
  h.cookie.mockReturnValue(cookie)
  remote = { info: { id: 900, dirid: 51, creator: { musicid: 7 }, owndir: 1, title: '原歌单', dir_show: 2,
    desc: '保留简介', picurl: 'https://y.qq.com/cover.jpg', picurl2: '', vec_tagid: [3, 5] }, songs: [] }
  h.request.mockImplementation(upstream)
})
it('会话不泄露 cookie，检查仅本人普通私密歌单', async () => {
  expect((await manage({}, 'session')).body).toEqual({ accountId: '7', accountToken: playbackAccountToken(cookie) })
  expect((await manage({}, 'inspect')).body).toEqual({ playlistId: '900', name: '原歌单', private: true })
  expect(writes()).toEqual([])
})
it('创建允许空歌单，私密创建且相同请求仅创建一次', async () => {
  expect((await manage({ action: 'create', tracks: [] })).body).toEqual({ playlistId: '900', status: 'complete', requested: 1, completed: 1 })
  expect((await manage({ action: 'create', tracks: [] })).body.status).toBe('complete')
  expect(writes()).toMatchObject([{ method: 'AddPlaylist', param: { dirShow: 2, dirName: '新名称' } }])
  expect((await manage({ action: 'create', name: '另一名称' })).status).toBe(400)
  expect(writes()).toHaveLength(1)
})
it('拒绝切换 QQ 歌单可见性且不发起写入', async () => {
  expect((await manage({ action: 'privacy', public: true })).status).toBe(400)
  expect(writes()).toEqual([])
})
it('拒绝创建公开 QQ 歌单且不发起写入', async () => {
  expect((await manage({ action: 'create', public: true })).status).toBe(400)
  expect(writes()).toEqual([])
})
it('创建响应后换号仍保存目标检查点，回到原账号重试不重复创建', async () => {
  h.request.mockImplementation(async (cookie, payload) => {
    const data = await upstream(cookie, payload)
    if (payload.playlist.method === 'AddPlaylist') h.cookie.mockReturnValue('uin=8; qqmusic_key=other')
    return data
  })
  expect((await manage({ action: 'create' })).body).toMatchObject({ playlistId: '900', status: 'unknown', completed: null })
  h.cookie.mockReturnValue(cookie); h.request.mockImplementation(upstream)
  expect((await manage({ action: 'create' })).body.status).toBe('complete')
  expect(writes().filter(block => block.method === 'AddPlaylist')).toHaveLength(1)
})
it('新增只添加指定缺失歌曲，移除只删除指定歌曲，其他曲目和名称不变', async () => {
  remote.songs = [song(9), song(1)]
  expect((await manage()).body).toEqual({ playlistId: '900', status: 'complete', requested: 2, completed: 2 })
  expect(writes()).toMatchObject([{ method: 'AddSonglist', param: { dirId: 51, tid: 900, v_songInfo: [{ songId: 2, songType: 1 }] } }])
  expect((await manage({ action: 'remove', tracks: tracks(1, 3) })).body).toMatchObject({ status: 'complete', completed: 2 })
  expect(remote.songs).toEqual([song(9), song(2)])
  expect(remote.info.title).toBe('原歌单')
  expect(writes().map(block => block.method)).toEqual(['AddSonglist', 'DelSonglist'])
})
it('已满足的增删不会发起写入', async () => {
  remote.songs = [song(1), song(2)]
  expect((await manage()).body.status).toBe('complete')
  expect((await manage({ action: 'remove', tracks: tracks(3) })).body.status).toBe('complete')
  expect(writes()).toEqual([])
})
it('改名读取最新完整字段保留简介、封面、标签、可见性', async () => {
  expect((await manage({ action: 'rename' })).body).toMatchObject({ status: 'complete', requested: 1, completed: 1 })
  expect(writes()).toMatchObject([{ method: 'EditPlaylist', param: { dirId: 51, mask: 95, dirNewName: '新名称', dirNewDesc: '保留简介',
    dirNewPicUrl: 'https://y.qq.com/cover.jpg', dirNewPicUrl2: '', dirNewtaglist: '3,5', dirShow: 2 } }])
})
it('缺失改名元数据拒绝写入，静默改名失败报告 partial', async () => {
  delete remote.info.picurl2
  expect((await manage({ action: 'rename' })).body).toMatchObject({ status: 'partial', completed: 0 })
  expect(writes()).toEqual([])
  remote.info.picurl2 = ''
  h.request.mockImplementation((cookie, payload) => payload.playlist.method === 'EditPlaylist' ? envelope({}) : upstream(cookie, payload))
  expect((await manage({ action: 'rename' })).body).toMatchObject({ status: 'partial', completed: 0 })
})
it.each([{ action: 'other' }, { action: 'create', requestId: '' }, { action: 'create', name: '名'.repeat(21) }, { playlistId: 'qq-liked:201' },
  { tracks: [] }, { tracks: [{ source: 'local', id: 'mid1' }] }, { tracks: tracks(1, 1) }, { tracks: [{ source: 'qq', id: 'mid1', qqId: '9007199254740993' }] }])('非法输入不访问上游 %j', async input => {
  expect((await manage(input)).status).toBe(400)
  expect(h.request).not.toHaveBeenCalled()
})
it.each([
  { creator: { musicid: 8 } }, { owndir: 0 }, { dirid: 201 }, { dirid: 206 }, { id: 901 },
  { dir_show: 1, creator: { musicid: 0 } }, { dir_show: 1, creator: { musicid: 8 } },
])('拒绝非本人普通歌单 %j', async changes => {
  Object.assign(remote.info, changes)
  expect((await manage()).status).toBe(409)
  expect(writes()).toEqual([])
})
it('本人公开歌单（creator 可见且匹配）可核验并加歌，inspect 如实返回公开', async () => {
  remote.info.dir_show = 1
  const inspected = await manage({}, 'inspect')
  expect(inspected.status).toBe(200)
  expect(inspected.body).toMatchObject({ private: false })
  expect((await manage()).status).toBe(200)
  expect(writes().length).toBeGreaterThan(0)
})
it('可见性未知时不写入', async () => {
  remote.info.dir_show = 0
  expect((await manage()).status).not.toBe(200)
  expect(writes()).toEqual([])
})
it('清单 uin、唯一匹配和 dirId 需要同时可信', async () => {
  for (const entries of [[{ tid: 900, dirId: 51, uin: 8 }], [{ tid: 900, dirId: 52, uin: 7 }],
    [{ tid: 900, dirId: 51, uin: 7 }, { tid: 900, dirId: 51, uin: 7 }]]) {
    h.request.mockImplementation((cookie, payload) => payload.playlist.method === 'GetPlaylistByUin' ? envelope({ v_playlist: entries }) : upstream(cookie, payload))
    expect((await manage()).status).toBe(409)
  }
  expect(writes()).toEqual([])
})
it.each([{ qqId: '9' }, { songType: 7 }])('客户端身份字段即使齐全也必须核实 %j', async changes => {
  expect((await manage({ tracks: [{ ...tracks(1)[0], ...changes }] })).status).toBe(409)
  expect(writes()).toEqual([])
  expect(h.request.mock.calls.some(([, payload]) => payload.playlist.method === 'get_song_detail_yqq')).toBe(true)
})
it('旧歌曲缺失数字身份和类型时从上游核实', async () => {
  expect((await manage({ tracks: [{ source: 'qq', id: 'mid2' }] })).body.status).toBe('complete')
  expect(writes()).toMatchObject([{ param: { v_songInfo: [{ songId: 2, songType: 1 }] } }])
})
it('静默漏写与业务码失败按回读报告 partial，保留其他歌曲', async () => {
  remote.songs = [song(9)]
  h.request.mockImplementation((cookie, payload) => payload.playlist.method === 'AddSonglist' ? envelope({ retCode: 80105 }) : upstream(cookie, payload))
  expect((await manage()).body).toMatchObject({ status: 'partial', completed: 0, requested: 2, error: expect.stringContaining('80105') })
  expect(remote.songs).toEqual([song(9)])
})
it('写入后回读失败不得假报完成，返回目标与 unknown', async () => {
  let written = false
  h.request.mockImplementation(async (cookie, payload) => {
    if (written && payload.playlist.method === 'GetPlaylistByUin') throw new Error('network unavailable')
    const result = await upstream(cookie, payload)
    if (payload.playlist.method === 'AddSonglist') written = true
    return result
  })
  expect((await manage()).body).toMatchObject({ playlistId: '900', status: 'unknown', completed: null })
})
it('分批失败仍回读，返回实际已完成数量而不撤回成功批次', async () => {
  const many = tracks(...Array.from({ length: 102 }, (_, index) => index + 1))
  h.request.mockImplementation((cookie, payload) => payload.playlist.method === 'AddSonglist' && payload.playlist.param.v_songInfo.length === 2
    ? envelope({ retCode: 80105 }) : upstream(cookie, payload))
  expect((await manage({ tracks: many })).body).toMatchObject({ status: 'partial', requested: 102, completed: 100 })
  expect(writes()).toHaveLength(2)
})
it('未登录、旧会话和方法错误不访问上游', async () => {
  expect((await manage({ accountToken: 'old' })).status).toBe(409)
  expect((await manage({}, 'manage', 'GET')).status).toBe(405)
  h.cookie.mockReturnValue('')
  expect((await manage()).status).toBe(401)
  expect(h.request).not.toHaveBeenCalled()
})
it('曲目核实中换号不写入，失效业务码返回 401', async () => {
  h.request.mockImplementation(async (cookie, payload) => { const result = await upstream(cookie, payload); h.cookie.mockReturnValue('uin=8; qqmusic_key=other'); return result })
  expect((await manage()).status).toBe(409)
  expect(writes()).toEqual([])
  h.cookie.mockReturnValue(cookie)
  h.request.mockResolvedValue(envelope({}, 301))
  expect((await manage()).status).toBe(401)
})
it('目标写锁拒绝并行请求，拒绝者不提前释放原锁', async () => {
  let release!: () => void
  h.request.mockImplementationOnce(async (cookie, payload) => { await new Promise<void>(resolve => { release = resolve }); return upstream(cookie, payload) })
  const first = manage()
  await vi.waitFor(() => expect(release).toBeTypeOf('function'))
  expect((await manage({ action: 'rename' })).status).toBe(409)
  expect((await manage({ action: 'remove' })).status).toBe(409)
  release()
  expect((await first).body.status).toBe('complete')
})
it('写入后回读出现 MID 与数字身份冲突不得报告完成', async () => {
  h.request.mockImplementation(async (cookie, payload) => {
    const data = await upstream(cookie, payload)
    if (payload.playlist.method === 'AddSonglist') remote.songs[0].mid = 'differentMid'
    return data
  })
  expect((await manage()).body).toMatchObject({ playlistId: '900', status: 'unknown', completed: null, error: expect.stringContaining('身份不一致') })
})
it('分页缺失时不对既有歌曲做任何写入', async () => {
  h.request.mockImplementation((cookie, payload) => payload.playlist.method === 'CgiGetDiss'
    ? envelope({ dirinfo: remote.info, total_song_num: 870, songlist: [song(1)], hasmore: 0 }) : upstream(cookie, payload))
  expect((await manage({ action: 'remove' })).body.error).toContain('不完整')
  expect(writes()).toEqual([])
})
it('私密歌单隐藏 creator 时仍要求清单归属和详情 owndir', async () => {
  remote.info.creator = { musicid: 0 }
  expect((await manage({}, 'inspect')).body).toEqual({ playlistId: '900', name: '原歌单', private: true })
  remote.info.owndir = 0
  expect((await manage({}, 'inspect')).status).toBe(409)
  expect(writes()).toEqual([])
})
it.each(['timeout', 'missing-id'] as const)('创建 %s 结果不明时同一请求不得再次写入', async failure => {
  h.request.mockImplementation((cookie, payload) => {
    if (payload.playlist.method !== 'AddPlaylist') return upstream(cookie, payload)
    if (failure === 'timeout') throw new Error('upstream timeout')
    return envelope({ retCode: 0, result: {} })
  })
  expect((await manage({ action: 'create' })).body).toMatchObject({ playlistId: '', status: 'unknown', completed: null })
  expect((await manage({ action: 'create' })).body).toMatchObject({ playlistId: '', status: 'unknown', completed: null, error: expect.stringContaining('先刷新') })
  expect((await manage({ action: 'create', name: '另一个名称' })).status).toBe(400)
  expect(writes()).toHaveLength(1)
})
it('创建检查点驱逐不会删除仍在上游等待的创建请求', async () => {
  let release!: () => void
  h.request.mockImplementationOnce(async (cookie, payload) => {
    await new Promise<void>(resolve => { release = resolve })
    return upstream(cookie, payload)
  })
  const original = { action: 'create', requestId: `active-${caseId}`, name: '保留活动创建' }
  const first = manage(original)
  await vi.waitFor(() => expect(release).toBeTypeOf('function'))
  for (let index = 0; index < 66; index++) {
    expect((await manage({ action: 'create', requestId: `evict-${caseId}-${index}`, name: '其他创建' })).body.status).toBe('complete')
  }
  release()
  expect((await first).body.status).toBe('complete')
  expect((await manage(original)).body.status).toBe('complete')
  expect(writes().filter(block => block.method === 'AddPlaylist' && block.param.dirName === '保留活动创建')).toHaveLength(1)
})
it('请求取消后即使响应连接尚在也停止后续平台写入', async () => {
  let incoming!: IncomingMessage
  h.request.mockImplementation(async (cookie, payload) => {
    const data = await upstream(cookie, payload)
    incoming.aborted = true
    return data
  })
  expect((await manage({}, 'manage', 'POST', req => { incoming = req })).status).toBe(409)
  expect(writes()).toEqual([])
})
