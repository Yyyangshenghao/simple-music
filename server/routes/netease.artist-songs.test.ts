import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/netease-client', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/netease-client')>(),
  call: vi.fn(),
}))
import { call } from '../lib/netease-client'
import { neteaseRoutes } from './netease'

async function request(offset = 0) {
  const res = { writeHead: vi.fn(), end: vi.fn() }
  const handled = await neteaseRoutes(
    {} as IncomingMessage,
    res as unknown as ServerResponse,
    new URL(`http://localhost/api/netease/artist/songs?id=5346&limit=50&offset=${offset}`),
    { userDataDir: '', port: 0 }
  )
  return {
    handled,
    status: res.writeHead.mock.calls[0]?.[0],
    body: res.end.mock.calls[0] && JSON.parse(res.end.mock.calls[0][0].toString()),
  }
}

describe('网易云歌手全部单曲分页', () => {
  afterEach(() => vi.restoreAllMocks())

  it('保留无版权目录项并标记为不可播放，游标仍按原始记录推进', async () => {
    vi.mocked(call).mockResolvedValue({
      status: 200,
      cookie: [],
      body: {
        total: 820,
        more: true,
        songs: [
          { id: 1, name: '可用歌曲', st: 0, ar: [{ id: 10, name: '王力宏' }] },
          { id: 2, name: '暂无版权歌曲', st: -1, ar: [{ id: 10, name: '王力宏' }] },
        ],
      },
    })

    expect(await request(50)).toMatchObject({
      handled: true,
      status: 200,
      body: {
        nextOffset: 52,
        hasMore: true,
        songs: [
          expect.objectContaining({ id: 1, playable: true }),
          expect.objectContaining({ id: 2, playable: false }),
        ],
      },
    })
    expect(call).toHaveBeenCalledWith('artist_songs', { id: '5346', limit: 50, offset: 50, cookie: '' })
  })

  it('最后一批按 total 正确结束', async () => {
    vi.mocked(call).mockResolvedValue({
      status: 200,
      cookie: [],
      body: { total: 51, more: false, songs: [{ id: 51, name: '末曲', st: 0 }] },
    })

    expect((await request(50)).body).toMatchObject({ nextOffset: 51, hasMore: false })
  })
})
