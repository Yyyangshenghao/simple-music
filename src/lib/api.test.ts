import { describe, it, expect, vi, afterEach } from 'vitest'
import { api } from './api'

function stubPort(port?: number): void {
  vi.stubGlobal('window', { desktop: port === undefined ? {} : { serverPort: port } })
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
