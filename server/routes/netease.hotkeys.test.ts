import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/netease-client', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/netease-client')>(),
  call: vi.fn(),
}))
import { call } from '../lib/netease-client'
import { neteaseRoutes } from './netease'

async function request() {
  const res = { writeHead: vi.fn(), end: vi.fn() }
  const handled = await neteaseRoutes(
    {} as IncomingMessage, res as unknown as ServerResponse,
    new URL('http://localhost/api/search/hotkeys'), { userDataDir: '', port: 0 }
  )
  return { handled, status: res.writeHead.mock.calls[0]?.[0], body: res.end.mock.calls[0] && JSON.parse(res.end.mock.calls[0][0].toString()) }
}

describe('网易云热搜路由', () => {
  afterEach(() => vi.restoreAllMocks())

  it('匿名读取，去空、去重并保序取前十条搜索词', async () => {
    vi.mocked(call).mockResolvedValue({ status: 200, cookie: [], body: { code: 200, data: [
      { searchWord: ' 晴天 ' }, { searchWord: '晴天' }, { searchWord: '' },
      { searchWord: 123 }, null, { searchWord: '稻香', url: 'https://example.com/promo' },
      ...Array.from({ length: 12 }, (_, i) => ({ searchWord: `热词${i}` })),
    ] } })
    expect(await request()).toEqual({ handled: true, status: 200, body: {
      provider: 'netease', keywords: ['晴天', '稻香', ...Array.from({ length: 8 }, (_, i) => `热词${i}`)],
    } })
    expect(call).toHaveBeenCalledWith('search_hot_detail', {})
  })

  it('上游成功但无热词时保留空结果', async () => {
    vi.mocked(call).mockResolvedValue({ status: 200, cookie: [], body: { code: 200, data: [] } })
    expect((await request()).body).toEqual({ provider: 'netease', keywords: [] })
  })

  it.each([
    { status: 200, body: { code: 301, data: [] } },
    { status: 503, body: { code: 200, data: [] } },
    { status: 200, body: { code: 200 } },
  ])('异常响应返回 502，不误报用户登录失效：%j', async (response) => {
    vi.mocked(call).mockResolvedValue({ ...response, cookie: [] })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await request()).toEqual({ handled: true, status: 502, body: {
      provider: 'netease', error: 'NETEASE_SEARCH_HOTKEYS_FAILED', keywords: [],
    } })
  })

  it('网络错误返回可降级错误', async () => {
    vi.mocked(call).mockRejectedValue(new Error('offline'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await request()).status).toBe(502)
  })
})
