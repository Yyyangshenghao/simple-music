import { PassThrough } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServerContext } from '../types'
import { appleMusicBridgeRoutes } from './apple-music-bridge'
import { appleMusicRoutes } from './apple-music'
import { fetchAppleMusic, getAppleMusicStatus } from '../lib/apple-music'

let ctx: ServerContext
beforeEach(() => {
  ctx = { userDataDir: mkdtempSync(join(tmpdir(), 'apple-web-route-')), port: 1234,
    appleMusicWeb: {
      open: vi.fn(async () => {}), close: vi.fn(async () => {}), logout: vi.fn(async () => {}),
      state: vi.fn(() => ({ connected: true, loggedIn: true, subscription: 'active' as const, storefront: 'us', playbackId: 'p1', status: 'playing' as const, position: 0, duration: 180 })),
      catalog: vi.fn(async () => ({ data: [{ id: '123' }] })), command: vi.fn(),
    } }
})
afterEach(() => rmSync(ctx.userDataDir, { recursive: true, force: true }))
async function request(path: string, body?: unknown) {
  const stream = new PassThrough()
  const req = Object.assign(stream, { method: body === undefined ? 'GET' : 'POST' }) as unknown as IncomingMessage
  const res = { setHeader: vi.fn(), writeHead: vi.fn(), end: vi.fn() }
  const url = new URL('/api/apple-music/' + path, 'http://localhost')
  const handler = path.startsWith('bridge/') ? appleMusicBridgeRoutes : appleMusicRoutes
  const pending = handler(req, res as unknown as ServerResponse, url, ctx)
  stream.end(body === undefined ? '' : JSON.stringify(body))
  await pending
  return { status: res.writeHead.mock.calls[0]?.[0], data: JSON.parse(String(res.end.mock.calls[0]?.[0])) }
}
describe('官网模式服务端接线', () => {
  it('原生歌词使用账号地区和逐字端点，拒绝任意路径', async () => {
    vi.mocked(ctx.appleMusicWeb!.catalog).mockResolvedValue({ data: [{ attributes: { ttml: '<tt/>' } }] })
    expect(await request('lyrics?id=123')).toEqual({ status: 200, data: { ttml: '<tt/>' } })
    expect(ctx.appleMusicWeb!.catalog).toHaveBeenCalledWith('/v1/catalog/us/songs/123/syllable-lyrics')
    expect((await request('lyrics?id=..%2Fsecret')).status).toBe(400)
  })
  it('个人库编号先映射曲库，逐字不可用时尝试行级且不退出登录', async () => {
    vi.mocked(ctx.appleMusicWeb!.catalog)
      .mockResolvedValueOnce({ data: [{ id: '456' }] })
      .mockRejectedValueOnce(new Error('403'))
      .mockResolvedValueOnce({ data: [{ attributes: { ttml: '<tt/>' } }] })
    expect((await request('lyrics?id=i.123&library=true')).data.ttml).toBe('<tt/>')
    expect(ctx.appleMusicWeb!.catalog).toHaveBeenNthCalledWith(3, '/v1/catalog/us/songs/456/lyrics')
    expect(ctx.appleMusicWeb!.logout).not.toHaveBeenCalled()
    expect(ctx.appleMusicWeb!.close).not.toHaveBeenCalled()
  })
  it('歌词拒绝访问时返回空内容供前端补位', async () => {
    vi.mocked(ctx.appleMusicWeb!.catalog).mockRejectedValue(new Error('403'))
    expect(await request('lyrics?id=123')).toEqual({ status: 200, data: { ttml: '' } })
    expect(ctx.appleMusicWeb!.command).not.toHaveBeenCalled()
  })

  it('登录状态将窗口失败原因交给界面', async () => {
    vi.mocked(ctx.appleMusicWeb!.state).mockReturnValue({ connected: false, loggedIn: false, subscription: 'unknown', storefront: 'cn', playbackId: '', status: 'idle', position: 0, duration: 0, error: '官网登录窗口已断开' })
    expect((await request('status')).data).toMatchObject({ connected: false, error: '官网登录窗口已断开' })
  })
  it('没有JWT也允许打开官网，状态使用真实浏览器会话', async () => {
    expect(getAppleMusicStatus(ctx)).toMatchObject({ configured: false, ready: true, loginMode: 'web', loggedIn: true, subscription: 'active' })
    expect(await request('bridge/open', { mode: 'web' })).toEqual({ status: 200, data: { opened: true } })
    expect(ctx.appleMusicWeb?.open).toHaveBeenCalledOnce()
    expect((await request('bridge/state')).data).toMatchObject({ playbackId: 'p1', status: 'playing' })
  })
  it('公开曲库与个人库均在官网请求，恶意路径不能到达浏览器', async () => {
    await expect(fetchAppleMusic(ctx, '/v1/me/library/playlists?offset=100')).resolves.toEqual({ data: [{ id: '123' }] })
    expect(ctx.appleMusicWeb?.catalog).toHaveBeenCalledWith('/v1/me/library/playlists?offset=100')
    await expect(fetchAppleMusic(ctx, 'https://example.com/secret')).rejects.toThrow('路径')
    expect(ctx.appleMusicWeb?.catalog).toHaveBeenCalledOnce()
  })
  it('控制和两种退出入口均传到官网会话', async () => {
    const command = { type: 'pause', playbackId: 'p1' }
    expect((await request('bridge/command', command)).status).toBe(200)
    expect(ctx.appleMusicWeb?.command).toHaveBeenCalledWith(command)
    await request('bridge/logout', {})
    await request('logout', {})
    expect(ctx.appleMusicWeb?.logout).toHaveBeenCalledTimes(2)
  })
  it('没有浏览器控制器时不伪报已打开，启动失败保留错误', async () => {
    vi.mocked(ctx.appleMusicWeb!.open).mockRejectedValueOnce(new Error('受保护媒体组件加载失败'))
    expect((await request('bridge/open', { mode: 'web' })).data.error).toContain('受保护媒体组件')
    ctx.appleMusicWeb = undefined
    expect((await request('bridge/open', { mode: 'web' })).data.error).toContain('桌面应用')
    expect((await request('bridge/open', { mode: 'unknown' })).status).toBe(400)
  })
})
