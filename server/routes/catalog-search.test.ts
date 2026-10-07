import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('../lib/netease-client', async (original) => ({ ...await original<typeof import('../lib/netease-client')>(), call: vi.fn() }))
vi.mock('../lib/qq-client', () => ({ qqMusicRequest: vi.fn() }))
vi.mock('../lib/cookie', () => ({ getCookie: () => '' }))
import { call } from '../lib/netease-client'
import { qqMusicRequest } from '../lib/qq-client'
import { catalogSearchRoutes } from './catalog-search'

async function request(source: 'qq' | 'netease', kind: 'albums' | 'playlists', keyword = '周杰伦') {
  const res = { writeHead: vi.fn(), end: vi.fn() }
  await catalogSearchRoutes({ method: 'GET' } as IncomingMessage, res as unknown as ServerResponse, new URL(`http://localhost/api/${source}/search/${kind}?keywords=${encodeURIComponent(keyword)}`), { userDataDir: '', port: 0 })
  return { status: res.writeHead.mock.calls[0][0], body: JSON.parse(res.end.mock.calls[0][0].toString()) }
}
const module = 'music.search.SearchCgiService'
describe('专辑与歌单搜索 API', () => {
  afterEach(() => vi.resetAllMocks())
  it('QQ 专辑使用类型 2 及专用搜索字段，保留 MID 和歌曲数量', async () => {
    vi.mocked(qqMusicRequest).mockResolvedValue({ [module]: { code: 0, data: { body: { album: { list: [{ albumMID: 'mid', albumName: '专辑', albumPic: 'http://y.gtimg.cn/album.jpg', song_count: 12, singerName: '歌手' }] } } } } })
    expect(await request('qq', 'albums')).toMatchObject({ status: 200, body: { albums: [{ source: 'qq', type: 'album', id: 'mid', name: '专辑', cover: 'https://y.gtimg.cn/album.jpg', creator: '歌手', trackCount: 12 }] } })
    expect(qqMusicRequest).toHaveBeenCalledWith('', { [module]: expect.objectContaining({ param: expect.objectContaining({ search_type: 2 }) }) })
  })
  it('QQ 歌单使用类型 3，数字字符串 ID 不丢精度', async () => {
    vi.mocked(qqMusicRequest).mockResolvedValue({ [module]: { code: 0, data: { body: { songlist: { list: [{ dissid: '7039749142', dissname: '歌单', song_count: 99, creator: { name: '作者' } }] } } } } })
    expect((await request('qq', 'playlists')).body.playlists[0]).toMatchObject({ id: '7039749142', type: 'playlist', creator: '作者', trackCount: 99 })
    expect(qqMusicRequest).toHaveBeenCalledWith('', { [module]: expect.objectContaining({ param: expect.objectContaining({ search_type: 3 }) }) })
  })
  it('网易云专辑使用类型 10，歌单类型 1000，保留实体来源', async () => {
    vi.mocked(call).mockResolvedValueOnce({ status: 200, cookie: [], body: { code: 200, result: { albums: [{ id: 1, name: '专辑', size: 10, artist: { name: '艺人' } }] } } })
    expect((await request('netease', 'albums')).body.albums[0]).toMatchObject({ source: 'netease', type: 'album', creator: '艺人' })
    expect(call).toHaveBeenLastCalledWith('cloudsearch', expect.objectContaining({ type: 10 }))
    vi.mocked(call).mockResolvedValueOnce({ status: 200, cookie: [], body: { code: 200, result: { playlists: [{ id: 2, name: '歌单', trackCount: 20 }] } } })
    expect((await request('netease', 'playlists')).body.playlists[0]).toMatchObject({ id: 2, source: 'netease', type: 'playlist' })
    expect(call).toHaveBeenLastCalledWith('cloudsearch', expect.objectContaining({ type: 1000 }))
  })
  it('上游错误保留失败状态，空关键词不发请求', async () => {
    vi.mocked(qqMusicRequest).mockResolvedValue({ [module]: { code: -1 } })
    expect((await request('qq', 'albums')).status).toBe(502)
    expect(await request('netease', 'playlists', ' ')).toEqual({ status: 200, body: { playlists: [] } })
    expect(call).not.toHaveBeenCalled()
  })
})
