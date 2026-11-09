import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/netease-client', async original => ({
  ...await original<typeof import('../lib/netease-client')>(),
  call: vi.fn(),
}))
import { call } from '../lib/netease-client'
import { neteaseRoutes } from './netease'

async function request() {
  const res = { writeHead: vi.fn(), end: vi.fn() }
  await neteaseRoutes({} as IncomingMessage, res as unknown as ServerResponse,
    new URL('http://localhost/api/netease/banner'), { userDataDir: '', port: 0 })
  return { status: res.writeHead.mock.calls[0][0], body: JSON.parse(res.end.mock.calls[0][0]) }
}

const song = (id: number) => ({ id, name: `歌曲${id}`, ar: [{ id: 9, name: '歌手' }], al: { picUrl: 'https://example.com/cover.jpg' } })

describe('网易歌曲精选', () => {
  afterEach(() => vi.resetAllMocks())

  it('先筛选歌曲目标再取五条，一次补全详情并保持原推荐顺序', async () => {
    vi.mocked(call).mockResolvedValueOnce({ status: 200, cookie: [], body: { code: 200, banners: [
      { targetType: 10, targetId: 900 }, { targetType: 3000, targetId: 0, url: 'https://example.com/ad' },
      ...[1, 2, 3, 4, 5, 6].map(targetId => ({ targetType: 1, targetId })),
    ] } }).mockResolvedValueOnce({ status: 200, cookie: [], body: { code: 200, songs: [5, 3, 1, 2, 4].map(song) } })
    const result = await request()
    expect(result.status).toBe(200)
    expect(result.body.banners.map((item: { track: { id: number } }) => item.track.id)).toEqual([1, 2, 3, 4, 5])
    expect(call).toHaveBeenLastCalledWith('song_detail', { ids: '1,2,3,4,5', cookie: '' })
    expect(result.body.partial).toBe(false)
  })

  it('已有内嵌歌曲不再查询，非歌曲和无效 ID 不进入精选', async () => {
    vi.mocked(call).mockResolvedValueOnce({ status: 200, cookie: [], body: { code: 200, banners: [
      { targetType: 10, targetId: 4, song: song(4) },
      { targetType: 1, targetId: 'https://example.com/track' },
      { targetType: 1, targetId: -1 },
      { targetType: 1, targetId: 2, song: song(2) },
    ] } })
    const result = await request()
    expect(result.body.banners).toHaveLength(1)
    expect(result.body.banners[0].track.id).toBe(2)
    expect(call).toHaveBeenCalledTimes(1)
  })

  it('详情失败时保留已有歌曲，无可用歌曲时返回明确的上游错误', async () => {
    vi.mocked(call).mockResolvedValueOnce({ status: 200, cookie: [], body: { code: 200, banners: [
      { targetType: 1, targetId: 1, song: song(1) }, { targetType: 1, targetId: 2 },
    ] } }).mockRejectedValueOnce(new Error('offline'))
    const partial = await request()
    expect(partial.status).toBe(200)
    expect(partial.body.partial).toBe(true)
    expect(partial.body.banners).toHaveLength(1)

    vi.mocked(call).mockResolvedValueOnce({ status: 200, cookie: [], body: { code: 200, banners: [{ targetType: 1, targetId: 2 }] } })
      .mockRejectedValueOnce(new Error('offline'))
    expect(await request()).toMatchObject({ status: 502, body: { error: expect.any(String), banners: [] } })
  })

  it('上游业务失败与没有歌曲推荐区别返回', async () => {
    vi.mocked(call).mockResolvedValueOnce({ status: 200, cookie: [], body: { code: 500 } })
    expect((await request()).status).toBe(502)
    vi.mocked(call).mockResolvedValueOnce({ status: 200, cookie: [], body: { code: 200, banners: [{ targetType: 10, targetId: 9 }] } })
    expect(await request()).toMatchObject({ status: 200, body: { banners: [], partial: false } })
  })
})
