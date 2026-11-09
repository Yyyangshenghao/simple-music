import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/netease-client', async importOriginal => ({
  ...await importOriginal<typeof import('../lib/netease-client')>(), call: vi.fn(),
}))
import { call } from '../lib/netease-client'
import { neteaseRoutes } from './netease'

afterEach(() => { vi.resetAllMocks(); vi.restoreAllMocks() })

async function request(query = 'id=186016') {
  const res = { writeHead: vi.fn(), end: vi.fn() }
  await neteaseRoutes({} as IncomingMessage, res as unknown as ServerResponse,
    new URL(`http://localhost/api/song/comments?${query}`), { userDataDir: '', port: 0 })
  return { status: res.writeHead.mock.calls[0][0], body: JSON.parse(res.end.mock.calls[0][0]) }
}

const comment = (id: number, content = `评论 ${id}`) => ({ commentId: id, content, user: { nickname: '听众' }, time: 1_700_000_000_000 })

describe('网易歌曲评论分页', () => {
  it('热评与最新首屏分别返回，最新第二页不跳过第一页', async () => {
    vi.mocked(call).mockResolvedValueOnce({ status: 200, cookie: [], body: {
      code: 200, total: 12, more: true, hotComments: [comment(100)],
      comments: Array.from({ length: 6 }, (_, index) => comment(index + 1, index === 0 ? '' : undefined)),
    } }).mockResolvedValueOnce({ status: 200, cookie: [], body: {
      code: 200, total: 12, more: false, hotComments: [comment(100)], comments: [comment(7)],
    } })

    const first = await request('id=186016&limit=6')
    expect(first.status).toBe(200)
    expect(first.body.comments.map((item: { id: number }) => item.id)).toEqual([2, 3, 4, 5, 6])
    expect(first.body.hotComments).toMatchObject([{ id: 100 }])
    expect(first.body.nextOffset).toBe(6)
    expect(first.body).not.toHaveProperty('body')

    const second = await request('id=186016&limit=6&offset=6')
    expect(second.body).toMatchObject({ comments: [{ id: 7 }], hotComments: [], total: 12 })
    expect(second.body).not.toHaveProperty('nextOffset')
    expect(vi.mocked(call).mock.calls.map(([, params]) => params.offset)).toEqual([0, 6])
  })

  it('没有热评时仍显示最新评论，总数缺失保持未知', async () => {
    vi.mocked(call).mockResolvedValue({ status: 200, cookie: [], body: {
      code: 200, hotComments: [], comments: [comment(1)],
    } })
    expect((await request()).body).toMatchObject({ comments: [{ id: 1 }], hotComments: [], total: null, hot: false })
  })

  it('未知总数时按原始页大小继续，空终页停止', async () => {
    vi.mocked(call).mockResolvedValueOnce({ status: 200, cookie: [], body: {
      code: 200, comments: Array.from({ length: 6 }, (_, index) => comment(index + 1)),
    } }).mockResolvedValueOnce({ status: 200, cookie: [], body: { code: 200, comments: [], more: true } })
    expect((await request('id=186016&limit=6')).body).toMatchObject({ total: null, nextOffset: 6 })
    expect((await request('id=186016&limit=6&offset=6')).body).not.toHaveProperty('nextOffset')
  })

  it.each([{ code: 301, comments: [] }, { code: 200 }, { code: 200, comments: null }])('上游失败或缺失列表返回 502 %j', async body => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(call).mockResolvedValue({ status: 200, cookie: [], body })
    expect(await request()).toMatchObject({ status: 502, body: { error: 'NETEASE_SONG_COMMENTS_FAILED', total: null } })
  })

  it.each(['', 'id=0', 'id=not-a-song', 'id=186016x'])('缺失或错误歌曲身份返回400 %s', async query => {
    expect((await request(query)).status).toBe(400)
    expect(call).not.toHaveBeenCalled()
  })
})
