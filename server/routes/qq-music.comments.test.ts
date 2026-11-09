import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/qq-client', async importOriginal => ({
  ...await importOriginal<typeof import('../lib/qq-client')>(), handleQQSongComments: vi.fn(),
}))
import { handleQQSongComments } from '../lib/qq-client'
import { qqRoutes } from './qq-music'

afterEach(() => { vi.resetAllMocks(); vi.restoreAllMocks() })

async function request(query: string) {
  const res = { writeHead: vi.fn(), end: vi.fn() }
  await qqRoutes({} as IncomingMessage, res as unknown as ServerResponse,
    new URL(`http://localhost/api/qq/song/comments?${query}`), { userDataDir: '', port: 0 })
  return { status: res.writeHead.mock.calls[0][0], body: JSON.parse(res.end.mock.calls[0][0]) }
}

describe('QQ评论路由', () => {
  it.each(['', 'id=mid123', 'id=0', 'id=9007199254740993'])('没有可用歌曲身份时返回400 %s', async query => {
    expect((await request(query)).status).toBe(400)
    expect(handleQQSongComments).not.toHaveBeenCalled()
  })

  it('MID与数字标识及连续分页原样交给客户端', async () => {
    vi.mocked(handleQQSongComments).mockResolvedValue({ comments: [], hotComments: [], total: 0 })
    expect((await request('qqId=4835221&songmid=0039abc12&limit=6&offset=6')).status).toBe(200)
    expect(handleQQSongComments).toHaveBeenCalledWith('', '4835221', '0039abc12', 6, 6)
  })

  it('仅有MID可交给歌曲详情补齐身份', async () => {
    vi.mocked(handleQQSongComments).mockResolvedValue({ comments: [], hotComments: [], total: 0 })
    expect((await request('mid=0039abc12')).status).toBe(200)
    expect(handleQQSongComments).toHaveBeenCalledWith('', '', '0039abc12', 20, 0)
  })

  it('读取失败返回502，不误报账号过期或空列表', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(handleQQSongComments).mockRejectedValue(new Error('offline'))
    expect(await request('id=4835221')).toEqual({ status: 502, body: { provider: 'qq', error: 'QQ_SONG_COMMENTS_FAILED', comments: [], hotComments: [], total: null } })
  })
})
