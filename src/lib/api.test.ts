import { describe, it, expect, vi, afterEach } from 'vitest'
import { api, isLocalApiUrl } from './api'

function stubPort(port?: number): void {
  vi.stubGlobal('window', { desktop: port === undefined ? {} : { serverPort: port } })
}

function stubPortToken(port: number, token: string): void {
  vi.stubGlobal('window', { desktop: { serverPort: port, serverToken: token } })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('api.url', () => {
  it('builds absolute url with injected port', () => {
    stubPort(40000)
    expect(api.url('/api/search', { keywords: 'hi', limit: 5 })).toBe(
      'http://127.0.0.1:40000/api/search?keywords=hi&limit=5'
    )
  })

  it('omits null/undefined params', () => {
    stubPort(40000)
    expect(api.url('/api/x', { a: 1, b: undefined, c: null })).toBe('http://127.0.0.1:40000/api/x?a=1')
  })

  it('falls back to relative path when no port', () => {
    stubPort()
    expect(api.url('/api/y', { z: 2 })).toBe('/api/y?z=2')
  })

  it('注入 token 时作为 query 参数附加', () => {
    stubPortToken(40000, 'tok123')
    expect(api.url('/api/search', { keywords: 'hi' })).toBe(
      'http://127.0.0.1:40000/api/search?keywords=hi&token=tok123'
    )
  })
})

describe('api.get', () => {
  it('parses json on ok', async () => {
    stubPort(40000)
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ songs: [] }) })
    vi.stubGlobal('fetch', fetchMock)
    const out = await api.get<{ songs: unknown[] }>('/api/search', { keywords: 'a' })
    expect(out).toEqual({ songs: [] })
    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:40000/api/search?keywords=a')
  })

  it('throws on non-ok', async () => {
    stubPort(40000)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
    await expect(api.get('/api/x')).rejects.toThrow('HTTP 500')
  })
})

describe('isLocalApiUrl', () => {
  // AudioEngine 用它决定「本地音乐是否还要套 /api/audio 代理」——
  // 套了会被 server 的 SSRF 防护按回环地址 400 掉,本地音乐直接放不出声。
  it('识别指向本地 API server 的地址', () => {
    stubPort(40000)
    // 用与 local-music-service 完全相同的构造方式生成 url,避免硬编码字符串
    // 与真实产物脱节导致这条断言"看着过了实际没覆盖"
    expect(isLocalApiUrl(api.url('/api/local/audio', { id: 'abc' }))).toBe(true)
    expect(isLocalApiUrl(api.url('/api/local/cover', { id: 'abc' }))).toBe(true)
  })

  it('上游 CDN 地址不算本地', () => {
    stubPort(40000)
    expect(isLocalApiUrl('https://m8c.music.126.net/x.mp3')).toBe(false)
    // 别的端口不是我们的 server
    expect(isLocalApiUrl('http://127.0.0.1:9999/api/local/audio?id=abc')).toBe(false)
  })

  it('无端口(非 Electron 回退)时一律按非本地处理', () => {
    stubPort()
    expect(isLocalApiUrl('http://127.0.0.1:40000/api/local/audio')).toBe(false)
  })
})

describe('api.coverImage', () => {
  it('上游封面走 /proxy/cover(canvas 采样需要 CORS 头)', () => {
    stubPort(40000)
    const out = api.coverImage('https://p1.music.126.net/abc.jpg')
    expect(out).toContain('/proxy/cover')
    expect(out).toContain(encodeURIComponent('https://p1.music.126.net/abc.jpg'))
  })

  it('本地封面(同源)不套代理:否则被 server 的 SSRF 防护当回环请求拦掉', () => {
    stubPort(40000)
    const local = 'http://127.0.0.1:40000/api/local/cover?id=abc'
    expect(api.coverImage(local)).toBe(local)
    expect(api.coverImage(local)).not.toContain('/proxy/cover')
  })

  it('无端口(纯前端回退)时仍走相对路径代理', () => {
    stubPort()
    expect(api.coverImage('https://x/y.jpg')).toContain('/proxy/cover')
  })

  it('带 token 的本地封面仍判为本地、不套代理(token 不破坏 isLocalApiUrl)', () => {
    stubPortToken(40000, 'tok123')
    // 本地封面由 api.url 构造，天然带 token
    const local = api.url('/api/local/cover', { id: 'abc' })
    expect(local).toContain('token=tok123')
    expect(isLocalApiUrl(local)).toBe(true)
    expect(api.coverImage(local)).toBe(local)
    expect(api.coverImage(local)).not.toContain('/proxy/cover')
  })
})
