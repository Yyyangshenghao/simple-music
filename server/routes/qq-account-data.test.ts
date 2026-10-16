import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ cookie: vi.fn(), request: vi.fn(), playlist: vi.fn() }))
vi.mock('../lib/cookie', async original => ({ ...await original<typeof import('../lib/cookie')>(), getCookie: h.cookie }))
vi.mock('../lib/qq-client', async original => ({
  ...await original<typeof import('../lib/qq-client')>(), qqMusicRequest: h.request, handleQQPlaylistTracks: h.playlist,
}))
import { qqAccountDataRoutes } from './qq-account-data'

const cookie = 'uin=7; qqmusic_key=fixture-key'
const today = new Date('2026-10-16T02:00:00Z')
const row = (mid = 'fixtureMid', lastTime = 3) => ({
  track: { mid, id: 123, name: '测试曲目', interval: 180, singer: [{ name: '测试歌手', mid: 'fixtureSinger' }], album: { name: '测试专辑', mid: 'fixtureAlbum' } },
  lastTime, listenCnt: 3,
})
const song = (id = 'fixtureMid') => ({ provider: 'qq', source: 'qq', type: 'qq', id, mid: id, name: '测试曲目', artist: '测试歌手', artists: [{ name: '测试歌手' }], duration: 180_000 })
const envelope = (data: unknown) => ({ code: 0, playlist: { code: 0, data } })
const recentData = (rows: unknown = [row()]) => ({ code: 0, type: 2, updateTime: 100, data: { songList: rows } })
const card = (changes: object = {}) => ({ subtype: 510, id: '900', time: today.getTime() / 1000, ...changes })
const feedData = (cards: unknown = [card()]) => ({ retcode: 0, v_shelf: [{ v_niche: [{ v_card: cards }] }] })
const playlist = (tracks: unknown = [song()]) => ({
  provider: 'qq', loggedIn: true, playlist: { id: '900', trackCount: Array.isArray(tracks) ? tracks.length : 1 },
  tracks, trackIds: Array.isArray(tracks) ? tracks.map(track => track.id) : ['fixtureMid'],
})

async function call(path = '/api/qq/history/recent-tracks', method = 'GET', destroyed = false) {
  const req = { method } as IncomingMessage
  const res = { destroyed, writeHead: vi.fn(), end: vi.fn(), setHeader: vi.fn() }
  const handled = await qqAccountDataRoutes(req, res as unknown as ServerResponse, new URL(`http://localhost${path}`), { userDataDir: 'test', port: 0 })
  return {
    handled, res,
    status: res.writeHead.mock.calls[0]?.[0],
    body: res.end.mock.calls.length ? JSON.parse(res.end.mock.calls[0][0].toString()) : undefined,
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(today)
  h.cookie.mockReturnValue(cookie)
  h.request.mockImplementation(async (_cookie, payload) => envelope(payload.playlist.method === 'GetPlayRecentlyInfo' ? recentData() : feedData()))
  h.playlist.mockResolvedValue(playlist())
})
afterEach(() => vi.useRealTimers())

describe('QQ 账号只读数据路由', () => {
  it('未命中不处理，两个接口仅接受 GET 且不缓存', async () => {
    expect((await call('/api/qq/other')).handled).toBe(false)
    for (const path of ['/api/qq/history/recent-tracks', '/api/qq/recommend/daily']) {
      const response = await call(path, 'POST')
      expect(response.status).toBe(405)
      expect(response.res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store')
    }
    expect(h.request).not.toHaveBeenCalled()
  })

  it.each(['', 'uin=7', 'qqmusic_key=fixture-key', 'uin=0; qqmusic_key=fixture-key'])('没有完整登录凭证则拒绝：%s', async value => {
    h.cookie.mockReturnValue(value)
    expect((await call()).status).toBe(401)
    expect(h.request).not.toHaveBeenCalled()
  })

  it.each([301, 1000])('上游硬鉴权错误返回 401：%s', async code => {
    h.request.mockResolvedValue({ code: 0, playlist: { code, data: recentData() } })
    expect(await call()).toMatchObject({ status: 401, body: { error: 'AUTH_EXPIRED' } })
  })
  it('2000签名要求保留为上游失败，不导致账号过期', async () => {
    h.request.mockResolvedValue({ code: 0, playlist: { code: 2000, data: recentData() } })
    expect(await call()).toMatchObject({ status: 502, body: { error: 'QQ_ACCOUNT_DATA_FAILED' } })
  })

  it('请求发出前已取消，不调用上游也不写响应', async () => {
    const response = await call(undefined, undefined, true)
    expect(h.request).not.toHaveBeenCalled()
    expect(response.res.end).not.toHaveBeenCalled()
  })

  it('最近歌曲途中换号，拒绝交付旧账号数据', async () => {
    h.request.mockImplementationOnce(async () => { h.cookie.mockReturnValue('uin=8; qqmusic_key=other-key'); return envelope(recentData()) })
    expect(await call()).toMatchObject({ status: 409, body: { error: 'QQ_ACCOUNT_CHANGED' } })
  })

  it('读取途中取消，不写任何响应', async () => {
    const req = { method: 'GET' } as IncomingMessage
    const res = { destroyed: false, writeHead: vi.fn(), end: vi.fn(), setHeader: vi.fn() }
    h.request.mockImplementationOnce(async () => { res.destroyed = true; return envelope(recentData()) })
    await qqAccountDataRoutes(req, res as unknown as ServerResponse, new URL('http://localhost/api/qq/history/recent-tracks'), { userDataDir: 'test', port: 0 })
    expect(res.end).not.toHaveBeenCalled()
  })
})

describe('QQ 最近歌曲', () => {
  it('固定请求最近窗口，按上游顺序映射毫秒时长并去重', async () => {
    h.request.mockResolvedValue(envelope(recentData([row('midB', 3), row('midA', 2), row('midB', 1)])))
    const response = await call('/api/qq/history/recent-tracks?limit=99999&type=1')
    expect(response.status).toBe(200)
    expect(response.body.songs.map((track: { id: string }) => track.id)).toEqual(['midB', 'midA'])
    expect(response.body.songs[0]).toMatchObject({ source: 'qq', qqId: 123, duration: 180_000, album: '测试专辑', artist: '测试歌手' })
    expect(h.request.mock.calls[0][1].playlist).toEqual({ module: 'music.musicasset.PlayRecentlyRead', method: 'GetPlayRecentlyInfo', param: { requestCnt: 2500, type: 2, updateTime: 0, lastTime: 0 } })
    expect(response.res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store')
  })

  it('最多处理 2500 条，不把窗口声明为完整历史', async () => {
    h.request.mockResolvedValue(envelope(recentData([...Array.from({ length: 2500 }, (_, i) => row(`mid${i}`)), {}])))
    expect((await call()).body.songs).toHaveLength(2500)
  })

  it('真实空数组成功，缺失或类型错误不能伪装空历史', async () => {
    h.request.mockResolvedValue(envelope(recentData([])))
    expect(await call()).toMatchObject({ status: 200, body: { songs: [] } })
    for (const data of [{ code: 0, type: 2, data: {} }, recentData(null), recentData({}), { ...recentData(), code: '0' }]) {
      h.request.mockResolvedValue(envelope(data))
      expect(await call()).toMatchObject({ status: 502, body: { error: 'QQ_ACCOUNT_DATA_FAILED' } })
    }
  })

  it.each([
    {}, { track: {} }, { ...row(), lastTime: '3' }, { ...row(), track: { ...row().track, name: 123 } },
    { ...row(), track: { ...row().track, mid: '' } }, { ...row(), track: { ...row().track, interval: '180' } },
    { ...row(), track: { ...row().track, singer: [{}] } },
  ])('曲目结构错误时整批拒绝：%j', async invalid => {
    h.request.mockResolvedValue(envelope(recentData([row(), invalid])))
    expect((await call()).status).toBe(502)
  })

  it.each([
    { code: 1, playlist: { code: 0, data: recentData() } },
    envelope({ ...recentData(), code: 1 }), envelope({ ...recentData(), subcode: 1 }),
    { code: 0, playlist: { data: recentData() } },
  ])('接口错误和缺失信封不能假成功：%j', async data => {
    h.request.mockResolvedValue(data)
    expect((await call()).status).toBe(502)
  })
})

describe('QQ 每日推荐', () => {
  const daily = () => call('/api/qq/recommend/daily')

  it('仅使用当天唯一日推卡动态 ID，并读取完整歌单', async () => {
    h.request.mockResolvedValue(envelope(feedData([{ subtype: 711, id: '99' }, card()])))
    const response = await daily()
    expect(response).toMatchObject({ status: 200, body: { songs: [song()] } })
    expect(h.request.mock.calls[0][1].playlist).toEqual({ module: 'music.recommend.RecommendFeed', method: 'get_recommend_feed', param: { direction: 0, page: 1, v_cache: [], v_uniq: [], s_num: 0 } })
    expect(h.playlist).toHaveBeenCalledWith(cookie, '900', expect.any(Function))
    expect(h.playlist.mock.calls[0][2]()).toBe(true)
    expect(response.res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store')
  })

  it.each([
    [], [{ subtype: 711, id: '99' }], [card(), card()], [card({ id: 'bad' })], [card({ id: 0 })],
    [card({ id: '9007199254740993' })], [card({ id: '0900' })], [card({ id: ' 900 ' })],
    [card({ id: {} })], [card({ subtype: '510' })],
  ].map(cards => ({ cards })))('没有唯一有效日推卡时拒绝，不退到猜你喜欢：$cards', async ({ cards }) => {
    h.request.mockResolvedValue(envelope(feedData(cards)))
    expect((await daily()).status).toBe(502)
    expect(h.playlist).not.toHaveBeenCalled()
  })

  it.each([{ ...feedData(), retcode: 1 }, { ...feedData(), retcode: '0' }, { retcode: 0 }, { retcode: 0, v_shelf: [{}] }, feedData({})])('推荐结构或内层状态错误时拒绝：%j', async data => {
    h.request.mockResolvedValue(envelope(data))
    expect((await daily()).status).toBe(502)
    expect(h.playlist).not.toHaveBeenCalled()
  })

  it.each([undefined, 0, today.getTime(), (today.getTime() - 86400_000) / 1000])('没有可靠的今日 Unix 秒日期时拒绝：%s', async time => {
    h.request.mockResolvedValue(envelope(feedData([card({ time })])))
    expect(await daily()).toMatchObject({ status: 409, body: { error: 'QQ_DAILY_EXPIRED' } })
    expect(h.playlist).not.toHaveBeenCalled()
  })

  it('上海午夜前发出的日推在跨日返回时拒绝', async () => {
    vi.setSystemTime(new Date('2026-10-16T15:59:59Z'))
    h.playlist.mockImplementationOnce(async () => { vi.setSystemTime(new Date('2026-10-16T16:00:00Z')); return playlist() })
    expect(await daily()).toMatchObject({ status: 409, body: { error: 'QQ_DAILY_EXPIRED' } })
  })

  it('推荐返回时换号不继续读取歌单', async () => {
    h.request.mockImplementationOnce(async () => { h.cookie.mockReturnValue('uin=8; qqmusic_key=other-key'); return envelope(feedData()) })
    expect((await daily()).status).toBe(409)
    expect(h.playlist).not.toHaveBeenCalled()
  })

  it('完整歌单返回时换号，不交付旧数据且守卫已失效', async () => {
    h.playlist.mockImplementationOnce(async (_cookie, _id, current) => {
      h.cookie.mockReturnValue('uin=8; qqmusic_key=other-key')
      expect(current()).toBe(false)
      return playlist()
    })
    expect((await daily()).status).toBe(409)
  })

  it.each([
    {}, { ...playlist(), error: 'FAILED' }, { ...playlist(), tracks: undefined }, { ...playlist(), loggedIn: false },
    { ...playlist(), playlist: { id: '900', trackCount: 2 } }, { ...playlist(), playlist: { id: '901', trackCount: 1 } },
    { ...playlist(), trackIds: [] }, { ...playlist(), trackIds: ['otherMid'] },
    playlist([song(), song()]), playlist([{ ...song(), source: 'netease' }]), playlist([{ ...song(), duration: '180000' }]),
  ])('歌单缺失、分页截断或曲目异常不能假成功：%j', async data => {
    h.playlist.mockResolvedValue(data)
    expect((await daily()).status).toBe(502)
  })

  it('详情请求失败时返回错误而非成功空数组', async () => {
    h.playlist.mockRejectedValue(new Error('upstream failed'))
    expect(await daily()).toMatchObject({ status: 502, body: { error: 'QQ_ACCOUNT_DATA_FAILED' } })
  })
})
