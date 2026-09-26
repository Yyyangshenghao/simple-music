import { request as httpRequest } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startServer } from '../index'
import * as httpHelpers from '../lib/http'
import { clearAppleMusicUserToken } from '../lib/apple-music'
import { revokeAppleMusicBridge } from '../lib/apple-music-bridge'

const appToken = 'desktop-secret'
const jwt = (exp = Math.floor(Date.now() / 1000) + 3600) => `${Buffer.from('{"alg":"ES256"}').toString('base64url')}.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.signature`
let server: Awaited<ReturnType<typeof startServer>>, userDataDir: string, base: string
const realFetch = globalThis.fetch
async function request(path: string, options: RequestInit = {}) {
  const response = await realFetch(base + path, options)
  return { status: response.status, headers: response.headers, body: await response.text() }
}
const app = (path: string, body?: unknown) => request(`/api/apple-music/${path}`, {
  method: body === undefined ? 'GET' : 'POST',
  headers: { 'x-simplemusic-token': appToken, 'Content-Type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) })
})
async function open() {
  const response = await app('bridge/open', {})
  expect(response.status).toBe(200)
  const url = new URL(JSON.parse(response.body).url)
  expect(url.origin).toBe(base)
  return url.hash.slice(1)
}
const scoped = (secret: string, path: string, body?: unknown) => request(`/apple-music-bridge/${path}`, {
  method: body === undefined ? 'GET' : 'POST',
  headers: { 'x-apple-music-session': secret, Origin: base, 'Content-Type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) })
})
beforeEach(async () => {
  vi.stubEnv('SIMPLEMUSIC_APPLE_MUSIC_DEVELOPER_TOKEN', '')
  userDataDir = mkdtempSync(join(tmpdir(), 'apple-http-'))
  server = await startServer({ userDataDir, token: appToken, allowLocalhostOrigins: false })
  base = `http://127.0.0.1:${server.port}`
  expect((await app('config', { developerToken: jwt(), storefront: 'us' })).status).toBe(200)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  const ctx = { userDataDir, port: server.port }
  clearAppleMusicUserToken(ctx)
  revokeAppleMusicBridge(ctx)
  server.close()
  rmSync(userDataDir, { recursive: true, force: true })
})

describe('完整 HTTP 服务中的 Apple Music 权限边界', () => {
  it('公开播放器不泄密，专属会话不能访问桌面 API，桌面凭据不能访问专属接口', async () => {
    const secret = await open()
    const page = await request('/apple-music-player')
    expect(page.status).toBe(200)
    expect(page.headers.get('cache-control')).toBe('no-store')
    for (const sensitive of [secret, appToken, jwt()]) expect(page.body).not.toContain(sensitive)
    expect((await scoped(appToken, 'config')).status).toBe(401)
    for (const path of ['/api/apple-music/status', '/api/apple-music/bridge/state', '/api/local/tracks']) {
      expect((await request(path, { headers: { 'x-apple-music-session': secret } })).status).toBe(401)
      expect((await request(path, { headers: { 'x-simplemusic-token': secret } })).status).toBe(401)
    }
    const config = await scoped(secret, 'config')
    expect(config.status).toBe(200)
    expect(config.headers.get('access-control-allow-origin')).toBeNull()
    expect((await app('status')).body).not.toContain(jwt())
  })
  it.each(['https://evil.test', 'null', 'http://localhost:5173'])('拒绝浏览器跨来源 %s，即使有专属会话', async origin => {
    const secret = await open()
    expect((await request('/apple-music-bridge/config', { headers: { Origin: origin, 'x-apple-music-session': secret } })).status).toBe(403)
  })
  it.each(['logout', 'bridge/logout', 'config'])('%s 后所有旧会话接口失效且无法恢复授权', async route => {
    const secret = await open()
    expect((await scoped(secret, 'auth', { token: 'user-secret' })).status).toBe(200)
    expect(JSON.parse((await app('status')).body).loggedIn).toBe(true)
    expect((await app(route, {})).status).toBe(200)
    for (const [path, body] of [['config', undefined], ['poll', undefined], ['auth', { token: 'late' }], ['state', { loggedIn: true }]] as const) {
      expect((await scoped(secret, path, body)).status).toBe(401)
    }
    expect(JSON.parse((await app('status')).body).loggedIn).toBe(false)
  })
  it('仅已授权且有心跳的播放窗口才报告可用连接', async () => {
    const secret = await open()
    expect(JSON.parse((await app('status')).body)).toMatchObject({ ready: true, connected: false })
    await scoped(secret, 'auth', { token: 'user-secret' })
    expect(JSON.parse((await app('status')).body)).toMatchObject({ loggedIn: true, connected: false })
    await scoped(secret, 'poll?ack=0')
    expect(JSON.parse((await app('status')).body)).toMatchObject({ loggedIn: true, connected: true })
    await open()
    expect(JSON.parse((await app('status')).body)).toMatchObject({ loggedIn: true, connected: false })
  })
  it('读取授权请求体期间退出，不允许迟到的 auth 恢复登录', async () => {
    const secret = await open()
    const body = JSON.stringify({ token: 'late-user' })
    let entered!: () => void
    const readingBody = new Promise<void>(resolve => { entered = resolve })
    const originalReadJson = httpHelpers.readJson
    vi.spyOn(httpHelpers, 'readJson').mockImplementation(req => {
      const result = originalReadJson(req)
      if (req.url === '/apple-music-bridge/auth') entered()
      return result
    })
    let finish!: () => void
    const response = new Promise<number | undefined>((resolve, reject) => {
      const req = httpRequest(base + '/apple-music-bridge/auth', { method: 'POST', headers: { 'x-apple-music-session': secret, 'Content-Length': Buffer.byteLength(body) } }, res => {
        res.resume()
        res.on('end', () => resolve(res.statusCode))
      })
      req.on('error', reject)
      req.write(body.slice(0, 1))
      finish = () => req.end(body.slice(1))
    })
    await readingBody
    await app('logout', {})
    finish()
    expect(await response).toBe(400)
    expect(JSON.parse((await app('status')).body).loggedIn).toBe(false)
  })
  it('开发者令牌在已连接期间过期，拒绝新窗口和旧窗口授权', async () => {
    const now = Date.now()
    await app('config', { developerToken: jwt(Math.floor(now / 1000) + 60) })
    const secret = await open()
    vi.spyOn(Date, 'now').mockReturnValue(now + 120000)
    expect((await app('bridge/open', {})).status).toBe(400)
    expect((await scoped(secret, 'auth', { token: 'expired-user' })).status).toBe(400)
    expect(JSON.parse((await app('status')).body).loggedIn).toBe(false)
  })
})

describe('完整 HTTP 服务中的代理契约', () => {
  it('分页保留路径和参数，仅个人资料库发送用户凭据', async () => {
    const upstream = vi.fn().mockImplementation(async () => Response.json({ data: [], next: '/v1/me/library/songs?offset=100' }))
    vi.stubGlobal('fetch', upstream)
    const secret = await open()
    await scoped(secret, 'auth', { token: 'private-user', storefront: 'us' })
    for (const path of ['/v1/catalog/us/albums/123/tracks?offset=100&limit=25', '/v1/me/library/songs?offset=100']) {
      const response = await app(`catalog?path=${encodeURIComponent(path)}`)
      expect(response.status).toBe(200)
      const [url, init] = upstream.mock.lastCall!
      expect(String(url)).toBe(`https://api.music.apple.com${path}`)
      expect(init.redirect).toBe('error')
      expect(init.headers['Music-User-Token']).toBe(path.startsWith('/v1/me') ? 'private-user' : undefined)
      expect(response.body).not.toContain('private-user')
    }
  })
  it.each(['https://evil.test/x', '//evil.test/x', '/v1/catalog/us/songs/%2e%2e', '/v1/catalog/us/songs/../search', '/v1/catalog/us/songs#secret'])('拒绝恶意分页 %s，网络请求前失败', async path => {
    const upstream = vi.fn()
    vi.stubGlobal('fetch', upstream)
    expect((await app(`catalog?path=${encodeURIComponent(path)}`)).status).toBe(400)
    expect(upstream).not.toHaveBeenCalled()
  })
  it.each([401, 403, 404, 429, 500])('上游 %s 返回稳定状态且不泄漏错误正文', async status => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('private-upstream-secret', { status })))
    const response = await app(`catalog?path=${encodeURIComponent('/v1/catalog/us/songs')}`)
    expect(response.status).toBe(status === 500 ? 502 : status)
    expect(response.body).not.toContain('private-upstream-secret')
  })
  it.each(['null', '[]', '"text"', '{invalid'])('错误配置正文 %s 不改变已有配置', async body => {
    const response = await request('/api/apple-music/config', { method: 'POST', headers: { 'x-simplemusic-token': appToken }, body })
    expect(response.status).toBe(400)
    expect(JSON.parse((await app('status')).body)).toMatchObject({ configured: true, loggedIn: false, storefront: 'us' })
  })
})
