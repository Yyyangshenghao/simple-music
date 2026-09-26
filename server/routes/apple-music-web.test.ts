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
