import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchSafeUpstream } from './upstream-fetch'

afterEach(() => vi.unstubAllGlobals())

describe('fetchSafeUpstream', () => {
  it.each([301, 302, 303, 307, 308])('支持 %i 公网及相对跳转，保留 Range', async (status) => {
    const cancel = vi.fn()
    const redirect = new Response(new ReadableStream({ cancel }), { status, headers: { location: '../audio/song.mp3' } })
    const final = new Response('audio', { status: 206, headers: { 'content-range': 'bytes 10-14/15' } })
    const upstream = vi.fn().mockResolvedValueOnce(redirect).mockResolvedValueOnce(final)
    vi.stubGlobal('fetch', upstream)
    const controller = new AbortController()
    const options = { headers: { Range: 'bytes=10-' }, signal: controller.signal }
    expect(await fetchSafeUpstream('https://cdn.example.com/redirect/start', options)).toBe(final)
    expect(upstream).toHaveBeenNthCalledWith(2, 'https://cdn.example.com/audio/song.mp3', { ...options, redirect: 'manual' })
    expect(cancel).toHaveBeenCalledOnce()
  })

  it.each(['http://127.0.0.1/secret', 'http://192.168.1.1/', 'file:///etc/passwd'])('拒绝第二跳之后的危险目标 %s', async (location) => {
    const upstream = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://other.example.com/next' } }))
      .mockResolvedValueOnce(new Response(null, { status: 307, headers: { location } }))
    vi.stubGlobal('fetch', upstream)
    await expect(fetchSafeUpstream('https://cdn.example.com/start')).rejects.toThrow('Invalid upstream url')
    expect(upstream).toHaveBeenCalledTimes(2)
  })

  it('限制循环重定向，并关闭每个重定向响应体', async () => {
    const cancel = vi.fn()
    const upstream = vi.fn(async () => new Response(new ReadableStream({ cancel }), {
      status: 302, headers: { location: '/loop' },
    }))
    vi.stubGlobal('fetch', upstream)
    await expect(fetchSafeUpstream('https://cdn.example.com/loop')).rejects.toThrow('Too many upstream redirects')
    expect(upstream).toHaveBeenCalledTimes(6)
    expect(cancel).toHaveBeenCalledTimes(6)
  })

  it('已取消的请求不再发起上游请求', async () => {
    const upstream = vi.fn()
    vi.stubGlobal('fetch', upstream)
    const controller = new AbortController()
    controller.abort()
    await expect(fetchSafeUpstream('https://cdn.example.com/song', { signal: controller.signal })).rejects.toThrow()
    expect(upstream).not.toHaveBeenCalled()
  })
})
