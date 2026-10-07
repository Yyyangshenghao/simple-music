import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { expectedAudioLength, isSupportedAudioPayload } from './audio-cache'
import { startServer } from '../index'
import { mkdtemp, readdir, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { audioCacheDir, openAudioCacheWriter, openAudioCacheEntry, pinAudioCacheEntry, listSavedAudioCache } from '../lib/audio-cache'

type OfflineLibraryItem = Awaited<ReturnType<typeof listSavedAudioCache>>[number]

describe('按选区删除离线音乐', () => {
  it('共享音频保留未选歌曲，最后一个保存删除时才清文件，导出歌曲始终保留', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'sm-offline-delete-'))
    const bytes = Buffer.from('ID3-offline-song')
    for (const source of ['netease', 'qq'] as const) {
      const origin = { source, id: 'same-id', name: source }
      const writer = await openAudioCacheWriter(userDataDir, 'qq:resolved:standard', {
        origin, resolved: { source: 'qq', id: 'resolved' }, quality: 'standard', pinned: true, expectedBytes: bytes.length,
      })
      await writer!.write(bytes)
      expect(await writer!.commit()).toBe(true)
    }
    const exported = join(audioCacheDir(userDataDir), '用户已下载.mp3')
    await writeFile(exported, bytes)
    const server = await startServer({ userDataDir, port: 0, token: 'test-token', allowLocalhostOrigins: false })
    const base = `http://127.0.0.1:${server.port}`
    const post = (body: unknown, token = 'test-token') => fetch(`${base}/api/audio-cache/delete?token=${token}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    })
    try {
      const response = await fetch(`${base}/api/audio-cache/library?token=test-token`)
      const { items } = await response.json() as { items: OfflineLibraryItem[] }
      expect(items).toHaveLength(2)
      const first = { entryId: items[0].entryId, origin: items[0].origin, savedAt: items[0].savedAt }
      expect((await post(first, '')).status).toBe(401)
      expect((await post({ ...first, savedAt: null })).status).toBe(400)
      expect((await post({ ...first, origin: { ...first.origin, id: 'not-selected' } })).status).toBe(404)
      expect((await post(first)).status).toBe(200)
      expect(await readFile(join(audioCacheDir(userDataDir), `${items[0].entryId}.bin`))).toEqual(bytes)
      const remaining = await (await fetch(`${base}/api/audio-cache/library?token=test-token`)).json() as { items: OfflineLibraryItem[] }
      expect(remaining.items.map(item => item.origin)).toEqual([items[1].origin])
      expect((await post(first)).status).toBe(404)
      expect((await post({ entryId: items[1].entryId, origin: items[1].origin, savedAt: items[1].savedAt })).status).toBe(200)
      await expect(readFile(join(audioCacheDir(userDataDir), `${items[1].entryId}.bin`))).rejects.toMatchObject({ code: 'ENOENT' })
      expect(await readFile(exported)).toEqual(bytes)
    } finally {
      server.close()
      await rm(userDataDir, { recursive: true, force: true })
    }
  })

  it('过期保存时间与正在播放的文件不被删除，释放读租约后可重试', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'sm-offline-busy-'))
    const origin = { source: 'netease' as const, id: 'playing' }
    const writer = await openAudioCacheWriter(userDataDir, 'netease:playing:standard', {
      origin, resolved: origin, quality: 'standard', pinned: true,
    })
    await writer!.write(Buffer.from('ID3-offline-song'))
    expect(await writer!.commit()).toBe(true)
    const server = await startServer({ userDataDir, port: 0 })
    const base = `http://127.0.0.1:${server.port}`
    let lease: Awaited<ReturnType<typeof openAudioCacheEntry>> = null
    try {
      const library = () => fetch(`${base}/api/audio-cache/library`).then(response => response.json()) as Promise<{ items: OfflineLibraryItem[] }>
      const [item] = (await library()).items
      const post = (savedAt: number) => fetch(`${base}/api/audio-cache/delete`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ entryId: item.entryId, origin, savedAt }),
      })
      const clock = vi.spyOn(Date, 'now').mockReturnValue(item.savedAt + 1000)
      await pinAudioCacheEntry(userDataDir, item.entryId, origin, true)
      clock.mockRestore()
      expect((await post(item.savedAt)).status).toBe(404)
      const [current] = (await library()).items
      lease = await openAudioCacheEntry(userDataDir, item.entryId, origin)
      expect((await post(current.savedAt)).status).toBe(409)
      expect((await library()).items).toHaveLength(1)
      lease!.release()
      lease = null
      expect((await post(current.savedAt)).status).toBe(200)
      expect((await library()).items).toEqual([])
    } finally {
      lease?.release()
      server.close()
      vi.restoreAllMocks()
      await rm(userDataDir, { recursive: true, force: true })
    }
  })

  it('同一音频正在重新写入时拒绝删除，取消写入后保留原文件供删除', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'sm-offline-writing-'))
    const origin = { source: 'qq' as const, id: 'writing' }
    const context = { origin, resolved: origin, quality: 'standard', pinned: true }
    const bytes = Buffer.from('ID3-original-song')
    const writer = await openAudioCacheWriter(userDataDir, 'qq:writing:standard', context)
    await writer!.write(bytes)
    expect(await writer!.commit()).toBe(true)
    const [item] = await listSavedAudioCache(userDataDir)
    const replacement = await openAudioCacheWriter(userDataDir, 'qq:writing:standard', context)
    const server = await startServer({ userDataDir, port: 0 })
    const post = () => fetch(`http://127.0.0.1:${server.port}/api/audio-cache/delete`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ entryId: item.entryId, origin, savedAt: item.savedAt }),
    })
    try {
      await replacement!.write(Buffer.from('ID3-replacement-song'))
      expect((await post()).status).toBe(409)
      expect(await readFile(join(audioCacheDir(userDataDir), `${item.entryId}.bin`))).toEqual(bytes)
      expect(await listSavedAudioCache(userDataDir)).toHaveLength(1)
      replacement!.abort()
      expect((await post()).status).toBe(200)
      expect(await listSavedAudioCache(userDataDir)).toEqual([])
    } finally {
      replacement?.abort()
      server.close()
      await rm(userDataDir, { recursive: true, force: true })
    }
  })
})

afterEach(() => vi.unstubAllGlobals())

describe('缓存清理与下载的隔离', () => {
  it('清理自动缓存后，已下载音频及共享该文件的歌曲仍可播放', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'sm-audio-clear-test-'))
    const bytes = new Uint8Array([0x49, 0x44, 0x33, 1])
    for (const [id, pinned, resolvedId] of [
      ['downloaded', true, 'shared'],
      ['cached-alias', false, 'shared'],
      ['automatic', false, 'temporary'],
    ] as const) {
      const writer = await openAudioCacheWriter(userDataDir, `qq:${resolvedId}:standard`, {
        origin: { source: 'netease', id }, resolved: { source: 'qq', id: resolvedId },
        quality: 'standard', expectedBytes: bytes.length, pinned,
      })
      await writer!.write(bytes)
      expect(await writer!.commit()).toBe(true)
    }
    const server = await startServer({ userDataDir, port: 0 })
    try {
      const base = `http://127.0.0.1:${server.port}`
      const cleared = await fetch(`${base}/api/audio-cache/clear`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scope: 'temporary' }),
      })
      expect(cleared.status).toBe(200)
      expect(await cleared.json()).toEqual({ ok: true })
      expect(await (await fetch(`${base}/api/audio-cache/stats`)).json()).toMatchObject({ temporaryFiles: 0, pinnedFiles: 1 })
      const { items } = await (await fetch(`${base}/api/audio-cache/library`)).json() as { items: Array<{ origin: { id: string }; entryId: string }> }
      expect(items).toHaveLength(1)
      expect(items[0].origin.id).toBe('downloaded')
      for (const id of ['downloaded', 'cached-alias']) {
        const audio = await fetch(`${base}/api/audio-cache/file?entryId=${items[0].entryId}&source=netease&id=${id}`)
        expect(audio.status).toBe(200)
        expect(new Uint8Array(await audio.arrayBuffer())).toEqual(bytes)
      }
      const statuses = await fetch(`${base}/api/audio-cache/status`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tracks: [{ source: 'netease', id: 'automatic' }, { source: 'netease', id: 'downloaded' }] }),
      })
      expect(await statuses.json()).toMatchObject({ statuses: [
        { id: 'automatic', state: 'missing' }, { id: 'downloaded', state: 'pinned' },
      ] })
    } finally {
      server.close()
      await rm(userDataDir, { recursive: true, force: true })
    }
  })
})

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
