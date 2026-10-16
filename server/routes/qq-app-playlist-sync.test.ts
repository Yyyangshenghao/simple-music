import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { beforeEach, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ request: vi.fn(), cookie: vi.fn() }))
vi.mock('../lib/qq-client', async original => ({ ...await original<typeof import('../lib/qq-client')>(), qqMusicRequest: h.request }))
vi.mock('../lib/cookie', async original => ({ ...await original<typeof import('../lib/cookie')>(), getCookie: h.cookie }))
import { playbackAccountToken } from '../lib/playback-account'
import { qqAppPlaylistSyncRoutes } from './qq-app-playlist-sync'

const cookie = 'uin=7; qqmusic_key=test-key; skey=csrf-key'
const song = (id: number, type = 0) => ({ id, type, mid: `mid${id}` })
let caseId = 0
let remote: { info: Record<string, unknown>; songs: ReturnType<typeof song>[] }
const envelope = (data: object = {}, code = 0) => ({ code: 0, playlist: { code, data } })
async function upstream(_cookie: string, payload: Record<string, any>) {
  const { method, param } = payload.playlist
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
async function sync(overrides: object = {}, method = 'POST', session = false) {
  const body = { appPlaylistId: `qq-app-${caseId}`, name: '应用歌单', accountId: '7', accountToken: playbackAccountToken(cookie),
    tracks: [3, 1, 2].map(id => ({ source: 'qq', id: `mid${id}`, qqId: String(id), songType: id === 2 ? 1 : 0 })), ...overrides }
  const req = Readable.from([Buffer.from(JSON.stringify(body))]) as IncomingMessage
  req.method = method
  const res = { destroyed: false, writeHead: vi.fn(), end: vi.fn(), setHeader: vi.fn() }
  await qqAppPlaylistSyncRoutes(req, res as unknown as ServerResponse, new URL(`http://localhost/api/qq/app-playlist-sync${session ? '/session' : ''}`), { userDataDir: 'test', port: 0 })
  return { status: res.writeHead.mock.calls[0]?.[0], body: res.end.mock.calls.length ? JSON.parse(res.end.mock.calls[0][0].toString()) : null }
}
const writes = () => h.request.mock.calls.map(([, payload]) => payload.playlist).filter(block => block.method !== 'CgiGetDiss')
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
  expect((await sync()).body).toEqual({ success: true, playlistId: '900' })
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
it('新增静默漏歌时不删除旧歌，失败保留目标并可重试', async () => {
  remote.songs = [song(9)]
  h.request.mockImplementation((cookie, payload) => payload.playlist.method === 'AddSonglist' ? envelope({ retCode: 0 }) : upstream(cookie, payload))
  expect((await sync({ playlistId: '900' })).body).toMatchObject({ success: false, playlistId: '900' })
  expect(remote.songs).toEqual([song(9)])
  expect(writes().some(block => block.method === 'DelSonglist')).toBe(false)
})
it('改名静默失败不能标记成功，缺少标签信息时不冒险编辑', async () => {
  remote.songs = [song(3), song(1), song(2, 1)]
  h.request.mockImplementation((cookie, payload) => payload.playlist.method === 'EditPlaylist' ? envelope({ retCode: 0 }) : upstream(cookie, payload))
  expect((await sync({ playlistId: '900' })).body.success).toBe(false)
  delete remote.info.vec_tagid
  h.request.mockClear()
  expect((await sync({ playlistId: '900' })).body.error).toContain('信息不完整')
  expect(writes()).toEqual([])
})
it('870首完整分页、100首分批写入，不误认第一页为全量', async () => {
  const tracks = Array.from({ length: 870 }, (_, index) => ({ source: 'qq', id: `mid${index + 1}`, qqId: String(index + 1), songType: 0 }))
  expect((await sync({ tracks })).body.success).toBe(true)
  expect(writes().filter(block => block.method === 'AddSonglist')).toHaveLength(9)
  expect(remote.songs).toHaveLength(870)
})
it('分页列表不完整或网络失败不能删除旧歌，也不能误判歌单删除后新建', async () => {
  h.request.mockResolvedValue(envelope({ dirinfo: remote.info, total_song_num: 870, songlist: [song(1)], hasmore: 0 }))
  expect((await sync({ playlistId: '900' })).body.error).toContain('不完整')
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
it('旧档未知类型先查MID并核对数字ID，保留非0类型后才创建写入', async () => {
  const tracks = [1, 2].map(id => ({ source: 'qq', id: `mid${id}`, qqId: String(id) }))
  expect((await sync({ tracks })).body.success).toBe(true)
  const methods = h.request.mock.calls.map(([, payload]) => payload.playlist.method)
  expect(methods.slice(0, 2)).toEqual(['get_song_detail_yqq', 'get_song_detail_yqq'])
  expect(writes().find(block => block.method === 'AddSonglist').param.v_songInfo).toEqual([{ songId: 1, songType: 0 }, { songId: 2, songType: 1 }])
})
it('旧档身份核实失败时不创建歌单、不写入歌曲', async () => {
  h.request.mockResolvedValue(envelope({ track_info: song(2, 1) }))
  expect((await sync({ tracks: [{ source: 'qq', id: 'mid1', qqId: '1' }] })).body.error).toContain('身份无法核实')
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
