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

async function lyrics(status = 200) {
  const response = { writeHead: vi.fn(), end: vi.fn() }
  await expect(neteaseRoutes({} as IncomingMessage, response as unknown as ServerResponse,
    new URL('http://127.0.0.1/api/lyric?id=1'), { userDataDir: '/unused', port: 0 })).resolves.toBe(true)
  expect(response.writeHead).toHaveBeenCalledWith(status, expect.anything())
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

it.each(['resolve', 'reject'])('新歌词接口遭风控（%s）不继续请求旧接口', async mode => {
  vi.mocked(has).mockReturnValue(true)
  const limited = { status: 400, body: { code: -460 }, cookie: [] }
  if (mode === 'resolve') vi.mocked(call).mockResolvedValue(limited)
  else vi.mocked(call).mockRejectedValue(limited)
  await lyrics(500)
  expect(call).toHaveBeenCalledTimes(1)
})

it('新歌词接口普通错误仍可回退旧接口', async () => {
  vi.mocked(has).mockReturnValue(true)
  vi.mocked(call).mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({
    status: 200, body: { lrc: { lyric: '[00:01.00]正文' } }, cookie: [],
  })
  expect(await lyrics()).toMatchObject({ lyric: '[00:01.00]正文', source: 'lyric' })
  expect(call).toHaveBeenCalledTimes(2)
})

it('旧歌词接口缺少对应音译时返回空串并保留旧音译', async () => {
  vi.mocked(has).mockReturnValue(false)
  vi.mocked(call).mockResolvedValue({ status: 200, cookie: [], body: {
    lrc: { lyric: '[00:01.00]正文' }, romalrc: { lyric: '[00:01.00]old roma' },
  } })
  expect(await lyrics()).toMatchObject({ romalrc: '[00:01.00]old roma', yromalrc: '', source: 'lyric' })
})
