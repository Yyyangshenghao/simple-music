import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/qq-client', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/qq-client')>(),
  handleQQSimilarSongs: vi.fn(), handleQQRelatedPlaylists: vi.fn(), handleQQArtistSimilar: vi.fn(),
}))
import { handleQQSimilarSongs, handleQQRelatedPlaylists, handleQQArtistSimilar } from '../lib/qq-client'
import { qqRoutes } from './qq-music'

afterEach(() => { vi.resetAllMocks(); vi.restoreAllMocks() })
async function request(path: string) {
  const res = { writeHead: vi.fn(), end: vi.fn() }
  const handled = await qqRoutes({} as IncomingMessage, res as unknown as ServerResponse,
    new URL(`http://localhost${path}`), { userDataDir: '', port: 0 })
  return { handled, status: res.writeHead.mock.calls[0][0], body: JSON.parse(res.end.mock.calls[0][0].toString()) }
}

describe('QQ 相关内容路由', () => {
  it('无账号状态也可读取相似歌曲，songid 转成数字', async () => {
    vi.mocked(handleQQSimilarSongs).mockResolvedValue([])
    expect(await request('/api/qq/song/similar?songid=5105986')).toEqual({ handled: true, status: 200,
      body: { provider: 'qq', songs: [] } })
    expect(handleQQSimilarSongs).toHaveBeenCalledWith(5105986)
  })

  it('相关歌单把上一批 ID 转为数字数组', async () => {
    vi.mocked(handleQQRelatedPlaylists).mockResolvedValue({ playlists: [], hasMore: false })
    expect((await request('/api/qq/song/related-playlists?songid=5105986&previousIds=123,456')).status).toBe(200)
    expect(handleQQRelatedPlaylists).toHaveBeenCalledWith(5105986, [123, 456])
  })

  it.each(['/api/qq/song/similar', '/api/qq/song/similar?songid=mid123',
    '/api/qq/song/related-playlists?songid=1e3',
    '/api/qq/song/related-playlists?songid=1&previousIds=123,invalid',
    '/api/qq/song/related-playlists?songid=1&previousIds=9007199254740993'])('拒绝无效 ID：%s', async (path) => {
    expect((await request(path)).status).toBe(400)
    expect(handleQQSimilarSongs).not.toHaveBeenCalled()
    expect(handleQQRelatedPlaylists).not.toHaveBeenCalled()
  })

  it('上游失败返回 502，不冒充登录失效', async () => {
    vi.mocked(handleQQRelatedPlaylists).mockRejectedValue(new Error('failed'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await request('/api/qq/song/related-playlists?songid=1')).toEqual({ handled: true, status: 502,
      body: { provider: 'qq', error: 'QQ_RELATED_CONTENT_FAILED', playlists: [], hasMore: false } })
  })

  it('相似歌手业务失败返回 502，不伪装成空结果', async () => {
    vi.mocked(handleQQArtistSimilar).mockRejectedValue(new Error('QQ_ARTIST_SIMILAR_FAILED'))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(await request('/api/qq/artist/similar?mid=artist-mid')).toEqual({
      handled: true,
      status: 502,
      body: { provider: 'qq', error: 'QQ_ARTIST_SIMILAR_FAILED', artists: [] },
    })
  })
})
