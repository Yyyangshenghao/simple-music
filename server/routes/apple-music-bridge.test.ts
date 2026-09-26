import { createServer, request, type Server } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServerContext } from '../types'
import { publicAppleMusicBridgeRoutes } from './apple-music-bridge'
import { openAppleMusicBridge, revokeAppleMusicBridge } from '../lib/apple-music-bridge'
vi.mock('../lib/apple-music', () => ({ getValidatedAppleMusicConfig: () => ({ developerToken: 'developer-only', storefront: 'cn' }), setAppleMusicUserToken: vi.fn(), clearAppleMusicUserToken: vi.fn() }))
let server: Server, ctx: ServerContext, base: string, secret: string
beforeEach(async () => {
  ctx = { port: 0, userDataDir: '/tmp/test', token: 'master-secret' }
  server = createServer(async (req, res) => {
    if (!await publicAppleMusicBridgeRoutes(req, res, new URL(req.url!, base), ctx)) { res.writeHead(404); res.end() }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  ctx.port = (server.address() as { port: number }).port
  base = `http://127.0.0.1:${ctx.port}`
  secret = new URL(openAppleMusicBridge(ctx)).hash.slice(1)
})
afterEach(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) })
describe('browser scope security', () => {
  it('serves a token-free page and no-store responses', async () => {
    const res = await fetch(base + '/apple-music-player')
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const page = await res.text()
    expect(page).not.toContain(secret)
    expect(page).not.toContain('master-secret')
    expect(page).not.toContain('developer-only')
  })
  it('requires its own secret and rejects other origins/hosts', async () => {
    const path = base + '/apple-music-bridge/config'
    expect((await fetch(path)).status).toBe(401)
    expect((await fetch(path, { headers: { 'x-apple-music-session': 'master-secret' } })).status).toBe(401)
    expect((await fetch(path, { headers: { 'x-apple-music-session': secret, Origin: 'https://evil.test' } })).status).toBe(403)
    // fetch 会重写 Host；用原生 HTTP 请求真正送出 DNS rebinding 风格的 Host。
    const wrongHostStatus = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(path, { headers: { 'x-apple-music-session': secret, Host: 'evil.test' } }, (res) => {
        res.resume()
        resolve(res.statusCode)
      })
      req.on('error', reject)
      req.end()
    })
    expect(wrongHostStatus).toBe(403)
    const res = await fetch(path, { headers: { 'x-apple-music-session': secret, Origin: base } })
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
    expect(await res.json()).toEqual({ developerToken: 'developer-only', storefront: 'cn' })
  })
  it('revokes all scoped endpoints without affecting app routes', async () => {
    revokeAppleMusicBridge(ctx)
    expect((await fetch(base + '/apple-music-bridge/poll', { headers: { 'x-apple-music-session': secret } })).status).toBe(401)
    expect((await fetch(base + '/api/other', { headers: { 'x-apple-music-session': secret } })).status).toBe(404)
  })
})
