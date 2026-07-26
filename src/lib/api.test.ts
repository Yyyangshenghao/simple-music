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

  // 漫游生成「点了卡在生成中没反应」的根因兜底:上游停滞不返回时,整条链路原先会永远挂起。
  it('请求超过兜底超时(30s)被中止并抛 REQUEST_TIMEOUT', async () => {
    stubPort(40000)
    vi.useFakeTimers()
    const fetchMock = vi.fn((_input: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    try {
      const pending = expect(api.get('/api/slow')).rejects.toThrow('REQUEST_TIMEOUT')
      await vi.advanceTimersByTimeAsync(30_000)
      await pending
    } finally {
      vi.useRealTimers()
    }
  })

  it('调用方 signal 主动中止按原始错误透传,不误报成超时', async () => {
    stubPort(40000)
    const ac = new AbortController()
    const fetchMock = vi.fn((_input: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted by caller')))
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const pending = api.get('/api/x', undefined, { signal: ac.signal })
    ac.abort()
    await expect(pending).rejects.toThrow('aborted by caller')
  })

  it('调用方传入已中止的 signal:立即按原始错误拒绝(不挂到超时)', async () => {
    stubPort(40000)
    const ac = new AbortController()
    ac.abort()
    const fetchMock = vi.fn((_input: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        if (init?.signal?.aborted) {
          reject(new Error('aborted by caller'))
          return
        }
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted by caller')))
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    await expect(api.get('/api/x', undefined, { signal: ac.signal })).rejects.toThrow('aborted by caller')
  })

  it('响应头已到达但 body 读取挂起,同样被兜底超时中止', async () => {
    stubPort(40000)
    vi.useFakeTimers()
    const fetchMock = vi.fn((_input: string, init?: RequestInit) => {
      return Promise.resolve({
        ok: true,
        json: () =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
          })
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    try {
      const pending = expect(api.get('/api/slow-body')).rejects.toThrow('REQUEST_TIMEOUT')
      await vi.advanceTimersByTimeAsync(30_000)
      await pending
    } finally {
      vi.useRealTimers()
    }
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
