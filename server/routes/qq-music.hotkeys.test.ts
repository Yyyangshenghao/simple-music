import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/qq-client', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/qq-client')>(),
  handleQQSearchHotkeys: vi.fn(),
}))
import { handleQQSearchHotkeys } from '../lib/qq-client'
import { qqRoutes } from './qq-music'

describe('QQ 热词路由', () => {
  afterEach(() => vi.restoreAllMocks())

  async function request() {
    const res = { writeHead: vi.fn(), end: vi.fn() }
    const handled = await qqRoutes(
      {} as IncomingMessage, res as unknown as ServerResponse,
      new URL('http://localhost/api/qq/search/hotkeys'), { userDataDir: '', port: 0 }
    )
    return { handled, status: res.writeHead.mock.calls[0][0], body: JSON.parse(res.end.mock.calls[0][0].toString()) }
  }

  it('无账号信息也能只读获取热词', async () => {
    vi.mocked(handleQQSearchHotkeys).mockResolvedValue(['测试热词'])
    expect(await request()).toEqual({ handled: true, status: 200, body: { provider: 'qq', keywords: ['测试热词'] } })
    expect(handleQQSearchHotkeys).toHaveBeenCalledWith()
  })

  it('上游失败返回 502，不把公开热词失败误报为账号失效', async () => {
    vi.mocked(handleQQSearchHotkeys).mockRejectedValue(new Error('upstream failed'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await request()).toEqual({ handled: true, status: 502, body: {
      provider: 'qq', error: 'QQ_SEARCH_HOTKEYS_FAILED', keywords: [],
    } })
  })
})
