import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { hasAppleMusicSession, openAppleMusicBridge } from './apple-music-bridge'
import { appleMusicApiUrl, clearAppleMusicUserToken, fetchAppleMusic, getAppleMusicConfig, getAppleMusicStatus, setAppleMusicConfig, setAppleMusicUserToken } from './apple-music'

const jwt = (exp = Math.floor(Date.now() / 1000) + 3600) => `${Buffer.from(JSON.stringify({ alg: 'ES256' })).toString('base64url')}.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.signature`
let ctx: { userDataDir: string; port: number }
beforeEach(() => {
  ctx = { userDataDir: mkdtempSync(join(tmpdir(), 'apple-music-test-')), port: 0 }
  vi.stubEnv('SIMPLEMUSIC_APPLE_MUSIC_DEVELOPER_TOKEN', '')
})
afterEach(() => {
  clearAppleMusicUserToken(ctx)
  rmSync(ctx.userDataDir, { recursive: true, force: true })
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('Apple Music 配置与用户授权', () => {
  it('仅保存开发者令牌，文件私有，状态不泄露令牌', () => {
    setAppleMusicConfig(ctx, { developerToken: jwt(), storefront: 'us' })
    setAppleMusicUserToken(ctx, 'user-secret', 'cn')
    expect(getAppleMusicStatus(ctx)).toMatchObject({ configured: true, ready: true, managed: false, connected: false, loggedIn: true, storefront: 'cn' })
    const path = join(ctx.userDataDir, 'apple-music.json')
    expect(readFileSync(path, 'utf8')).not.toContain('user-secret')
    if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600)
    clearAppleMusicUserToken(ctx)
    expect(getAppleMusicStatus(ctx).loggedIn).toBe(false)
    expect(getAppleMusicConfig(ctx).storefront).toBe('us')
  })
  it('校验令牌和地区，空令牌移除配置，保存使旧用户授权失效', () => {
    expect(() => setAppleMusicConfig(ctx, { developerToken: 'bad' })).toThrow('JWT')
    expect(() => setAppleMusicConfig(ctx, { developerToken: jwt(1) })).toThrow('已过期')
    expect(() => setAppleMusicConfig(ctx, { developerToken: jwt(), storefront: '../' })).toThrow('地区')
    setAppleMusicConfig(ctx, { developerToken: jwt() })
    setAppleMusicUserToken(ctx, 'user-secret')
    setAppleMusicConfig(ctx, { developerToken: '' })
    expect(getAppleMusicStatus(ctx)).toMatchObject({ configured: false, ready: false, managed: false, connected: false, loggedIn: false, storefront: 'cn' })
  })
  it('开发者令牌过期后状态不再报告用户登录', () => {
    vi.stubEnv('SIMPLEMUSIC_APPLE_MUSIC_DEVELOPER_TOKEN', jwt())
    setAppleMusicUserToken(ctx, 'user-secret')
    expect(getAppleMusicStatus(ctx).loggedIn).toBe(true)
    vi.stubEnv('SIMPLEMUSIC_APPLE_MUSIC_DEVELOPER_TOKEN', jwt(1))
    expect(getAppleMusicStatus(ctx)).toMatchObject({ configured: true, ready: false, managed: true, connected: false, loggedIn: false, storefront: 'cn' })
  })
  it('环境变量覆盖本地 token', () => {
    setAppleMusicConfig(ctx, { developerToken: jwt() })
    const env = jwt(Math.floor(Date.now() / 1000) + 7200)
    vi.stubEnv('SIMPLEMUSIC_APPLE_MUSIC_DEVELOPER_TOKEN', env)
    expect(getAppleMusicConfig(ctx).developerToken).toBe(env)
  })
})

describe('Apple Music 代理边界', () => {
  it.each(['/v1/catalog/cn/search?term=a&types=songs&offset=25', '/v1/catalog/us/albums/123/tracks?offset=100', '/v1/catalog/cn/artists/123/view/top-songs?offset=25', '/v1/me/library/playlists/p.123/tracks?offset=100', '/v1/me/recommendations?offset=10'])('允许资源分页 %s', path => {
    expect(appleMusicApiUrl(path).href).toBe(`https://api.music.apple.com${path}`)
  })
  it.each(['https://evil.test/v1/catalog/cn/songs', '//evil.test/v1/catalog/cn/songs', '/v1/catalog/cn/songs/../search', '/v1/catalog/cn/songs/%2e%2e', '/v1/catalog/cn/songs\\evil', '/v1/me/favorites', '/v1/me/recommendations/unknown', '/v1/catalog/cn/songs#secret', '/v1/catalog/cn/unknown'])('拒绝任意目标 %s', path => {
    expect(() => appleMusicApiUrl(path)).toThrow()
  })
  it('曲库不附用户凭据，个人资源附用户凭据，不跟随重定向', async () => {
    const developerToken = jwt()
    setAppleMusicConfig(ctx, { developerToken })
    const request = vi.fn().mockImplementation(async () => new Response('{"data":[]}'))
    vi.stubGlobal('fetch', request)
    await expect(fetchAppleMusic(ctx, '/v1/me/library/songs')).rejects.toThrow('先登录')
    expect(request).not.toHaveBeenCalled()
    setAppleMusicUserToken(ctx, 'user-secret')
    await fetchAppleMusic(ctx, '/v1/catalog/cn/songs?ids=123')
    expect(request.mock.calls[0][1]).toMatchObject({ headers: { Authorization: `Bearer ${developerToken}` }, redirect: 'error' })
    expect(request.mock.calls[0][1].headers).not.toHaveProperty('Music-User-Token')
    await fetchAppleMusic(ctx, '/v1/me/library/songs')
    expect(request.mock.calls[1][1].headers['Music-User-Token']).toBe('user-secret')
  })
  it('区分开发者和用户授权失败，隐藏上游错误正文', async () => {
    setAppleMusicConfig(ctx, { developerToken: jwt() })
    setAppleMusicUserToken(ctx, 'user-secret')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('secret', { status: 401 })))
    await expect(fetchAppleMusic(ctx, '/v1/catalog/cn/songs')).rejects.toThrow('开发者令牌')
    setAppleMusicUserToken(ctx, 'user-secret')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('secret', { status: 403 })))
    await expect(fetchAppleMusic(ctx, '/v1/me/library/songs')).rejects.toThrow('用户授权')
    expect(getAppleMusicStatus(ctx).loggedIn).toBe(false)
  })
  it('将超时和网络错误转为中文且不泄漏凭据', async () => {
    setAppleMusicConfig(ctx, { developerToken: jwt() })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('secret', 'TimeoutError')))
    await expect(fetchAppleMusic(ctx, '/v1/catalog/cn/charts')).rejects.toThrow('请求超时')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('user-secret')))
    await expect(fetchAppleMusic(ctx, '/v1/catalog/cn/charts')).rejects.toThrow('无法连接')
  })
})

describe('上游授权失败与重新登录竞态', () => {
  it.each([[401, '/v1/catalog/cn/songs'], [403, '/v1/catalog/cn/songs'], [403, '/v1/me/library/songs']])('当前授权失败 %s 撤销用户和播放窗口', async (status, path) => {
    setAppleMusicConfig(ctx, { developerToken: jwt() })
    setAppleMusicUserToken(ctx, 'old-user')
    const secret = new URL(openAppleMusicBridge(ctx)).hash.slice(1)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: Number(status) })))
    await expect(fetchAppleMusic(ctx, String(path))).rejects.toThrow()
    expect(getAppleMusicStatus(ctx).loggedIn).toBe(false)
    expect(hasAppleMusicSession(ctx, secret)).toBe(false)
  })
  it.each(['user', 'developer'])('旧请求不能撤销更新的 %s 凭据和播放窗口', async changed => {
    setAppleMusicConfig(ctx, { developerToken: jwt() })
    setAppleMusicUserToken(ctx, 'old-user')
    let finish!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise<Response>(resolve => { finish = resolve })))
    const pending = fetchAppleMusic(ctx, '/v1/catalog/cn/songs')
    if (changed === 'developer') vi.stubEnv('SIMPLEMUSIC_APPLE_MUSIC_DEVELOPER_TOKEN', jwt(Math.floor(Date.now() / 1000) + 7200))
    else setAppleMusicUserToken(ctx, 'new-user')
    const secret = new URL(openAppleMusicBridge(ctx)).hash.slice(1)
    finish(new Response('', { status: 401 }))
    await expect(pending).rejects.toThrow()
    expect(getAppleMusicStatus(ctx).loggedIn).toBe(true)
    expect(hasAppleMusicSession(ctx, secret)).toBe(true)
  })
})

it('无用户授权的旧曲库请求不能撤销新打开的窗口', async () => {
  setAppleMusicConfig(ctx, { developerToken: jwt() })
  openAppleMusicBridge(ctx)
  let finish!: (response: Response) => void
  vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise<Response>(resolve => { finish = resolve })))
  const pending = fetchAppleMusic(ctx, '/v1/catalog/cn/songs')
  const secret = new URL(openAppleMusicBridge(ctx)).hash.slice(1)
  finish(new Response('', { status: 403 }))
  await expect(pending).rejects.toThrow()
  expect(hasAppleMusicSession(ctx, secret)).toBe(true)
})
