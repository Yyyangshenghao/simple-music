import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { expectedAudioLength, isSupportedAudioPayload } from './audio-cache'
import { startServer } from '../index'
import { mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { audioCacheDir } from '../lib/audio-cache'

afterEach(() => vi.unstubAllGlobals())

describe('主动保存上游校验', () => {
  it('只接受可证明完整的 200 或从零覆盖全文件的 206', () => {
    expect(expectedAudioLength(200, '1024', null)).toBe(1024)
    expect(expectedAudioLength(200, null, null)).toBeNull()
    expect(expectedAudioLength(206, '1024', 'bytes 0-1023/1024')).toBe(1024)
    expect(expectedAudioLength(206, '512', 'bytes 0-511/1024')).toBeNull()
    expect(expectedAudioLength(206, '1024', 'bytes 1-1024/1025')).toBeNull()
  })

  it('接受音频 MIME 或常见音频文件头，拒绝 HTML', () => {
    expect(isSupportedAudioPayload('audio/mpeg', new Uint8Array())).toBe(true)
    expect(isSupportedAudioPayload('text/plain', new TextEncoder().encode('fLaCdata'))).toBe(true)
    expect(isSupportedAudioPayload('text/html', new TextEncoder().encode('<!doctype ht'))).toBe(false)
    expect(isSupportedAudioPayload('application/octet-stream', new TextEncoder().encode('<!doctype ht'))).toBe(false)
  })
})

describe('主动保存路由', () => {
  it('完整音频保存后可按内容来源查到固定状态', async () => {
    const clientFetch = fetch
    const bytes = new Uint8Array([0x49, 0x44, 0x33, 1, 2, 3])
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(bytes, {
      status: 200,
      headers: { 'content-type': 'audio/mpeg', 'content-length': String(bytes.length) },
    })))
    const userDataDir = await mkdtemp(join(tmpdir(), 'sm-audio-route-test-'))
    const server = await startServer({ userDataDir, port: 0 })
    try {
      const base = `http://127.0.0.1:${server.port}`
      const saved = await clientFetch(`${base}/api/audio-cache/save`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          url: 'https://cdn.example.com/song.mp3',
          cacheKey: 'netease:123:standard',
          origin: { source: 'netease', id: '123', name: '测试歌曲' },
          resolved: { source: 'netease', id: '123' },
          quality: 'standard',
          trial: false,
        }),
      })
      expect(saved.status).toBe(200)
      expect(await saved.json()).toMatchObject({ ok: true, status: { state: 'pinned', size: bytes.length } })

      const library = await clientFetch(`${base}/api/audio-cache/library`)
      expect(library.status).toBe(200)
      expect(await library.json()).toMatchObject({ items: [{ origin: { source: 'netease', id: '123', name: '测试歌曲' }, size: bytes.length }] })

      const status = await clientFetch(`${base}/api/audio-cache/status`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tracks: [{ source: 'netease', id: '123' }] }),
      })
      expect(await status.json()).toMatchObject({ statuses: [{ source: 'netease', id: '123', state: 'pinned' }] })

      const lookup = await clientFetch(`${base}/api/audio-cache/status`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tracks: [{ source: 'netease', id: '123' }] }),
      })
      const { statuses } = await lookup.json() as { statuses: Array<{ entryId: string }> }
      const fileUrl = `${base}/api/audio-cache/file?entryId=${statuses[0].entryId}&source=netease&id=123`
      const cachedFile = await clientFetch(fileUrl, { headers: { Range: 'bytes=1-3' } })
      expect(cachedFile.status).toBe(206)
      expect(cachedFile.headers.get('content-range')).toBe('bytes 1-3/6')
      expect(cachedFile.headers.get('content-type')).toBe('audio/mpeg')
      expect(new Uint8Array(await cachedFile.arrayBuffer())).toEqual(bytes.slice(1, 4))
      expect((await clientFetch(fileUrl.replace('id=123', 'id=other'))).status).toBe(404)
    } finally {
      server.close()
    }
  })
})

describe('保存失败和取消的文件完整性', () => {
  const clientFetch = fetch
  let server: Awaited<ReturnType<typeof startServer>>
  let userDataDir: string
  let base: string
  const bytes = new Uint8Array([0x49, 0x44, 0x33, 1, 2, 3])
  const payload = {
    url: 'https://cdn.example.com/song.mp3', cacheKey: 'netease:123:standard',
    origin: { source: 'netease', id: '123' }, resolved: { source: 'netease', id: '123' },
    quality: 'standard', trial: false,
  }
  function save(body = payload, signal?: AbortSignal) {
    return clientFetch(`${base}/api/audio-cache/save`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body), signal,
    })
  }
  async function expectNoFiles() {
    const files = await readdir(audioCacheDir(userDataDir)).catch(() => [] as string[])
    expect(files.filter((name) => name.endsWith('.bin') || name.endsWith('.part'))).toEqual([])
  }
  beforeEach(async () => {
    userDataDir = await mkdtemp(join(tmpdir(), 'sm-audio-route-failure-test-'))
    server = await startServer({ userDataDir, port: 0 })
    base = `http://127.0.0.1:${server.port}`
  })
  afterEach(() => server.close())

  it.each([
    { trial: true }, { url: 'http://127.0.0.1/private' },
    { cacheKey: 'qq:other:standard' },
  ])('非法保存输入 %j 在读取上游前被拒绝', async (patch) => {
    const upstream = vi.fn()
    vi.stubGlobal('fetch', upstream)
    expect((await save({ ...payload, ...patch })).status).toBe(400)
    expect(upstream).not.toHaveBeenCalled()
    await expectNoFiles()
  })

  it.each([
    { status: 403, mime: 'audio/mpeg', length: '6' },
    { status: 200, mime: 'text/html', length: '6' },
    { status: 200, mime: 'audio/mpeg', length: '100' },
  ])('失败响应 %j 不留下正式文件或半截文件', async ({ status, mime, length }) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      mime === 'text/html' ? '<html>' : bytes,
      { status, headers: { 'content-type': mime, 'content-length': length } }
    )))
    expect((await save()).status).toBe(502)
    await vi.waitFor(expectNoFiles)
  })

  it('取消请求真正中止上游读取，并清理 part 文件', async () => {
    let signal: AbortSignal | null | undefined
    const upstream = vi.fn((_input: string, init?: RequestInit) => {
      signal = init?.signal
      return Promise.resolve(new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes)
          signal?.addEventListener('abort', () => controller.error(new DOMException('cancelled', 'AbortError')))
        },
      }), { headers: { 'content-type': 'audio/mpeg', 'content-length': '100' } }))
    })
    vi.stubGlobal('fetch', upstream)
    const controller = new AbortController()
    const pending = save(payload, controller.signal).catch((error: unknown) => error)
    await vi.waitFor(async () => {
      const files = await readdir(audioCacheDir(userDataDir))
      expect(files.some((name) => name.endsWith('.part'))).toBe(true)
    })
    controller.abort()
    expect(await pending).toBeInstanceOf(Error)
    await vi.waitFor(() => expect(signal?.aborted).toBe(true))
    await vi.waitFor(expectNoFiles)
  })
})
