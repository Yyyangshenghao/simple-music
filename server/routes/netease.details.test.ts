import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/netease-client', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/netease-client')>(), call: vi.fn(),
}))
import { call } from '../lib/netease-client'
import { neteaseRoutes } from './netease'

afterEach(() => vi.resetAllMocks())
describe('网易云专辑详情元信息', () => {
  it('已有曲目接口同时提供当前专辑简介，保持歌曲返回格式', async () => {
    vi.mocked(call).mockResolvedValue({ status: 200, cookie: [], body: {
      album: { id: 123, name: '测试专辑', description: '专辑介绍', size: 1 },
      songs: [{ id: 1, name: '歌曲', ar: [{ id: 2, name: '歌手' }] }],
    } })
    const res = { writeHead: vi.fn(), end: vi.fn() }
    await neteaseRoutes({} as IncomingMessage, res as unknown as ServerResponse,
      new URL('http://localhost/api/netease/album/songs?id=123'), { userDataDir: '', port: 0 })
    expect(res.writeHead.mock.calls[0][0]).toBe(200)
    expect(JSON.parse(res.end.mock.calls[0][0])).toMatchObject({
      playlist: { id: 123, source: 'netease', type: 'album', description: '专辑介绍' },
      songs: [{ id: 1, name: '歌曲' }],
    })
    expect(call).toHaveBeenCalledWith('album', { id: '123', cookie: '' })
  })
})
