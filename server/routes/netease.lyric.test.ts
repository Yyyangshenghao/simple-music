import { afterEach, expect, it, vi } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { neteaseRoutes } from './netease'
import { call, has } from '../lib/netease-client'

vi.mock('../lib/netease-client', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/netease-client')>(),
  call: vi.fn(), has: vi.fn(),
}))
vi.mock('../lib/cookie', () => ({ getCookie: () => '' }))
afterEach(() => vi.resetAllMocks())

async function lyrics() {
  const response = { writeHead: vi.fn(), end: vi.fn() }
  await expect(neteaseRoutes({} as IncomingMessage, response as unknown as ServerResponse,
    new URL('http://127.0.0.1/api/lyric?id=1'), { userDataDir: '/unused', port: 0 })).resolves.toBe(true)
  expect(response.writeHead).toHaveBeenCalledWith(200, expect.anything())
  return JSON.parse(response.end.mock.calls[0][0].toString())
}

it('歌词接口同时透传旧音译和与逐字时间轴对应的音译', async () => {
  vi.mocked(has).mockReturnValue(true)
  vi.mocked(call).mockResolvedValue({ status: 200, cookie: [], body: {
    lrc: { lyric: '[00:01.00]正文' }, yrc: { lyric: '[1500,500](1500,500,0)正文' },
    romalrc: { lyric: '[00:01.00]old roma' }, yromalrc: { lyric: '[00:01.50]native roma' },
  } })
  expect(await lyrics()).toMatchObject({ romalrc: '[00:01.00]old roma', yromalrc: '[00:01.50]native roma', source: 'lyric_new' })
})

it('旧歌词接口缺少对应音译时返回空串并保留旧音译', async () => {
  vi.mocked(has).mockReturnValue(false)
  vi.mocked(call).mockResolvedValue({ status: 200, cookie: [], body: {
    lrc: { lyric: '[00:01.00]正文' }, romalrc: { lyric: '[00:01.00]old roma' },
  } })
  expect(await lyrics()).toMatchObject({ romalrc: '[00:01.00]old roma', yromalrc: '', source: 'lyric' })
})
