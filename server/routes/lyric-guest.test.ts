import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/cookie', () => ({ getCookie: vi.fn(), setCookie: vi.fn(), clearCookie: vi.fn() }))
vi.mock('../lib/netease-client', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/netease-client')>(),
  call: vi.fn(), has: vi.fn(), handleSearch: vi.fn(),
}))
vi.mock('../lib/qq-client', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/qq-client')>(),
  handleQQLyric: vi.fn(), handleQQSearch: vi.fn(),
}))
import { getCookie } from '../lib/cookie'
import { call, has, handleSearch } from '../lib/netease-client'
import { handleQQLyric, handleQQSearch } from '../lib/qq-client'
import { neteaseRoutes } from './netease'
import { qqRoutes } from './qq-music'

async function request(route: typeof neteaseRoutes, path: string) {
  const res = { writeHead: vi.fn(), end: vi.fn() }
  const handled = await route({} as IncomingMessage, res as unknown as ServerResponse, new URL(`http://127.0.0.1${path}`), { userDataDir: '/unused', port: 0 })
  return { handled, status: res.writeHead.mock.calls[0]?.[0] }
}

beforeEach(() => {
  vi.mocked(getCookie).mockReturnValue('MUSIC_U=account-secret')
  vi.mocked(has).mockReturnValue(true)
  vi.mocked(call).mockResolvedValue({ status: 200, cookie: [], body: { lrc: { lyric: '[00:01.00]正文' } } })
  vi.mocked(handleSearch).mockResolvedValue([])
  vi.mocked(handleQQSearch).mockResolvedValue([])
  vi.mocked(handleQQLyric).mockResolvedValue({ provider: 'qq', lyric: '' })
})
afterEach(() => vi.resetAllMocks())

describe('游客歌词查询不带账号 Cookie', () => {
  it('网易云歌词与搜索：guest=1 时传空 Cookie，否则沿用账号', async () => {
    expect(await request(neteaseRoutes, '/api/lyric?id=1&guest=1')).toEqual({ handled: true, status: 200 })
    expect(vi.mocked(call).mock.calls.every(([, params]) => params.cookie === '')).toBe(true)
    await request(neteaseRoutes, '/api/search?keywords=a&guest=1')
    expect(handleSearch).toHaveBeenLastCalledWith('a', 20, '')
    vi.mocked(call).mockClear()
    await request(neteaseRoutes, '/api/lyric?id=1')
    expect(vi.mocked(call).mock.calls[0][1].cookie).toBe('MUSIC_U=account-secret')
    await request(neteaseRoutes, '/api/search?keywords=a')
    expect(handleSearch).toHaveBeenLastCalledWith('a', 20, 'MUSIC_U=account-secret')
  })

  it('QQ 歌词与搜索：guest=1 时传空 Cookie，逐字参数照常透传', async () => {
    await request(qqRoutes, '/api/qq/lyric?mid=m&id=1&words=1&guest=1')
    expect(handleQQLyric).toHaveBeenLastCalledWith('', 'm', '1', true)
    await request(qqRoutes, '/api/qq/search?keywords=a&limit=20&guest=1')
    expect(handleQQSearch).toHaveBeenLastCalledWith('', 'a', 20)
    await request(qqRoutes, '/api/qq/lyric?mid=m&id=1')
    expect(handleQQLyric).toHaveBeenLastCalledWith('MUSIC_U=account-secret', 'm', '1', false)
  })
})
