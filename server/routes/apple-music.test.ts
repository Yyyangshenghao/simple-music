import { PassThrough } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { appleMusicRoutes } from './apple-music'
import { hasAppleMusicSession, openAppleMusicBridge } from '../lib/apple-music-bridge'
import { clearAppleMusicUserToken, setAppleMusicUserToken } from '../lib/apple-music'

let ctx: { userDataDir: string; port: number }
beforeEach(() => {
  vi.stubEnv('SIMPLEMUSIC_APPLE_MUSIC_DEVELOPER_TOKEN', '')
  ctx = { userDataDir: mkdtempSync(join(tmpdir(), 'apple-route-test-')), port: 0 }
})
afterEach(() => {
  clearAppleMusicUserToken(ctx)
  rmSync(ctx.userDataDir, { recursive: true, force: true })
  vi.unstubAllEnvs()
})
async function request(path: string, method = 'GET', body = '') {
  const stream = new PassThrough()
  const req = Object.assign(stream, { method }) as unknown as IncomingMessage
  const response = { setHeader: vi.fn(), writeHead: vi.fn(), end: vi.fn() }
  const pending = appleMusicRoutes(req, response as unknown as ServerResponse, new URL(`/api/apple-music/${path}`, 'http://localhost'), ctx)
  stream.end(body)
  await pending
  return { status: response.writeHead.mock.calls[0]?.[0], data: JSON.parse(String(response.end.mock.calls[0]?.[0])), headers: response.setHeader }
}

it('状态和退出返回公开契约且禁止缓存', async () => {
  vi.stubEnv('SIMPLEMUSIC_APPLE_MUSIC_DEVELOPER_TOKEN', `${Buffer.from(JSON.stringify({ alg: 'ES256' })).toString('base64url')}.${Buffer.from(JSON.stringify({ exp: Date.now() / 1000 + 1000 })).toString('base64url')}.signature`)
  setAppleMusicUserToken(ctx, 'secret')
  const status = await request('status')
  expect(status.headers).toHaveBeenCalledWith('Cache-Control', 'no-store')
  expect(status.data).toMatchObject({ configured: true, loggedIn: true, storefront: 'cn' })
  expect((await request('logout', 'POST')).data).toMatchObject({ configured: true, loggedIn: false, storefront: 'cn' })
})
it('拒绝错误方法和非对象 JSON，不返回内部错误', async () => {
  expect((await request('config')).status).toBe(405)
  for (const body of ['null', '[]', '{bad']) {
    const response = await request('config', 'POST', body)
    expect(response.status).toBe(400)
    expect(response.data).toMatchObject({ ok: false })
  }
})
it('代理输入路径不合法时在网络请求前拒绝', async () => {
  const response = await request(`catalog?path=${encodeURIComponent('https://localhost/secret')}`)
  expect(response.status).toBe(400)
  expect(response.data).toEqual({ ok: false, error: 'Apple Music 请求路径无效' })
})

it('退出和保存配置撤销旧播放窗口权限', async () => {
  for (const route of ['logout', 'config']) {
    const secret = new URL(openAppleMusicBridge(ctx)).hash.slice(1)
    expect(hasAppleMusicSession(ctx, secret)).toBe(true)
    expect((await request(route, 'POST', '{}')).status).toBe(200)
    expect(hasAppleMusicSession(ctx, secret)).toBe(false)
  }
})
