import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/qq-client', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/qq-client')>(), handleQQPlaylistTracks: vi.fn(),
}))
import { handleQQPlaylistTracks } from '../lib/qq-client'
import { qqRoutes } from './qq-music'

afterEach(() => vi.resetAllMocks())
async function request(id: string) {
  const res = { writeHead: vi.fn(), end: vi.fn() }
  await qqRoutes({} as IncomingMessage, res as unknown as ServerResponse,
    new URL(`http://localhost/api/qq/playlist/tracks?id=${encodeURIComponent(id)}`), { userDataDir: '', port: 0 })
  return { status: res.writeHead.mock.calls[0][0], body: JSON.parse(res.end.mock.calls[0][0]) }
}
describe('QQ 歌单入口校验', () => {
  it.each(['1e3', '0', '-1', '9007199254740993'])('非法数字 ID 返回 400，不调用上游：%s', async (id) => {
    expect(await request(id)).toMatchObject({ status: 400, body: { error: 'INVALID_QQ_PLAYLIST_ID' } })
    expect(handleQQPlaylistTracks).not.toHaveBeenCalled()
  })
  it.each(['7799808010', 'qq-liked:201', 'qq-toplist:62'])('保留正常及特殊歌单引用：%s', async (id) => {
    vi.mocked(handleQQPlaylistTracks).mockResolvedValue({ loggedIn: true, tracks: [] })
    expect((await request(id)).status).toBe(200)
    expect(handleQQPlaylistTracks).toHaveBeenCalledWith('', id)
  })
})
