import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { neteaseRoutes, pipeReaderToResponse } from './netease'
import { clearAudioCacheScope } from '../lib/audio-cache'
import { audioCacheRoutes } from './audio-cache'

function response() {
  const events = new EventEmitter()
  return Object.assign(events, {
    destroyed: false,
    headersSent: false,
    writeHead: vi.fn(function (this: { headersSent: boolean }, _status: number) { this.headersSent = true }),
    write: vi.fn(() => true),
    end: vi.fn(),
    destroy() {
      this.destroyed = true
      events.emit('close')
    },
  })
}

afterEach(() => vi.unstubAllGlobals())

describe('代理边界', () => {
  it.each(['/proxy/cover', '/api/cover', '/api/audio'])('%s 拒绝公网重定向到回环地址', async (route) => {
    // 模拟 fetch 默认自动跟随重定向时会读到的私网内容。
    const upstream = vi.fn(async (_url: string, init?: RequestInit) => init?.redirect === 'manual'
      ? new Response(null, { status: 302, headers: { location: 'http://127.0.0.1:9123/secret' } })
      : new Response('PRIVATE_SERVICE_SECRET'))
    vi.stubGlobal('fetch', upstream)
    const res = response()
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await neteaseRoutes({ headers: {} } as IncomingMessage, res as unknown as ServerResponse,
        new URL(`http://localhost${route}?url=https://cdn.example.com/redirect`), { userDataDir: '', port: 0 })
      expect(res.writeHead.mock.calls[0][0]).toBe(500)
      expect(upstream).toHaveBeenCalledTimes(1)
      expect(res.end).not.toHaveBeenCalledWith(expect.stringContaining('PRIVATE_SERVICE_SECRET'))
    } finally { log.mockRestore() }
  })

  it.each(['/proxy/cover', '/api/cover', '/api/audio'])('%s 响应头返回前断开会立即取消下载，不占用缓存写锁', async (route) => {
    const directory = await mkdtemp(join(tmpdir(), 'sm-proxy-early-close-'))
    let release!: (response: Response) => void
    let signal: AbortSignal | null | undefined
    const gate = new Promise<Response>((resolve) => { release = resolve })
    const cancelled = vi.fn()
    const body = new ReadableStream<Uint8Array>({ cancel: cancelled })
    const upstream = new Response(body, { headers: { 'content-type': 'audio/mpeg' } })
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => {
      signal = init?.signal
      return gate
    }))
    const res = response()
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const request = neteaseRoutes({ headers: {} } as IncomingMessage, res as unknown as ServerResponse,
      new URL(`http://localhost${route}?url=https://cdn.example.com/song.mp3&cacheKey=netease:1:standard`),
      { userDataDir: directory, port: 0 })
    try {
      await vi.waitFor(() => expect(fetch).toHaveBeenCalled())
      res.destroy()
      expect(signal?.aborted).toBe(true)
      release(upstream)
      await request
      expect(cancelled).toHaveBeenCalledOnce()
      expect(res.writeHead).not.toHaveBeenCalled()
      expect(await clearAudioCacheScope(directory, 'all')).toEqual({ ok: true })
    } finally {
      release(upstream)
      await upstream.body?.cancel().catch(() => {})
      await request
      log.mockRestore()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('主动保存也拒绝跳转到私网，不写入音频缓存', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sm-save-redirect-'))
    const upstream = vi.fn(async (_url: string, init?: RequestInit) => init?.redirect === 'manual'
      ? new Response(null, { status: 302, headers: { location: 'http://127.0.0.1:9123/secret' } })
      : new Response('ID3-private-audio', { headers: { 'content-type': 'audio/mpeg', 'content-length': '17' } }))
    vi.stubGlobal('fetch', upstream)
    const req = Object.assign(Readable.from([Buffer.from(JSON.stringify({
      url: 'https://cdn.example.com/redirect', cacheKey: 'netease:1:standard',
      origin: { source: 'netease', id: '1' }, resolved: { source: 'netease', id: '1' }, quality: 'standard',
    }))]), { method: 'POST', headers: {} }) as IncomingMessage
    const res = response()
    try {
      await audioCacheRoutes(req, res as unknown as ServerResponse, new URL('http://localhost/api/audio-cache/save'),
        { userDataDir: directory, port: 0 })
      expect(res.writeHead).toHaveBeenCalledWith(502, expect.any(Object))
      expect(upstream).toHaveBeenCalledTimes(1)
      expect(await clearAudioCacheScope(directory, 'all')).toEqual({ ok: true })
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  it('进入转发前响应已关闭时取消读取，不等待首块', async () => {
    const res = response()
    res.destroy()
    const read = vi.fn(async () => ({ done: true as const, value: undefined }))
    const cancel = vi.fn(async () => {})
    expect(await pipeReaderToResponse({ read, cancel } as unknown as ReadableStreamDefaultReader<Uint8Array>,
      res as unknown as ServerResponse)).toBe(false)
    expect(read).not.toHaveBeenCalled()
    expect(cancel).toHaveBeenCalledOnce()
  })
})
