import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { api } from './api'

declare global {
  // eslint-disable-next-line no-var
  var window: { desktop?: { serverPort?: number } } | undefined
}

describe('api.url', () => {
  beforeEach(() => {
    globalThis.window = { desktop: { serverPort: 40000 } }
  })
  afterEach(() => {
    globalThis.window = undefined
  })

  it('builds absolute url with injected port', () => {
    expect(api.url('/api/search', { keywords: 'hi', limit: 5 })).toBe(
      'http://127.0.0.1:40000/api/search?keywords=hi&limit=5'
    )
  })

  it('omits null/undefined params', () => {
    expect(api.url('/api/x', { a: 1, b: undefined, c: null })).toBe('http://127.0.0.1:40000/api/x?a=1')
  })

  it('falls back to relative path when no port', () => {
    globalThis.window = { desktop: {} }
    expect(api.url('/api/y', { z: 2 })).toBe('/api/y?z=2')
  })
})

describe('api.get', () => {
  it('parses json on ok', async () => {
    globalThis.window = { desktop: { serverPort: 40000 } }
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ songs: [] }) })
    vi.stubGlobal('fetch', fetchMock)
    const out = await api.get<{ songs: unknown[] }>('/api/search', { keywords: 'a' })
    expect(out).toEqual({ songs: [] })
    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:40000/api/search?keywords=a')
    vi.unstubAllGlobals()
    globalThis.window = undefined
  })

  it('throws on non-ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
    await expect(api.get('/api/x')).rejects.toThrow('HTTP 500')
    vi.unstubAllGlobals()
  })
})
