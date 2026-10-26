import { afterEach, describe, expect, it, vi } from 'vitest'

const workers: FakeWorker[] = []
class FakeWorker {
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: (() => void) | null = null
  posted: unknown[] = []
  terminate = vi.fn()
  constructor() { workers.push(this) }
  postMessage(message: unknown) { this.posted.push(message) }
}
vi.mock('./separator.worker?worker&inline', () => ({ default: FakeWorker }))
vi.mock('onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url', () => ({ default: 'file:///ort.wasm' }))
vi.mock('../api', () => ({
  api: {
    url: (path: string, params?: Record<string, string>) => `http://127.0.0.1${path}?${new URLSearchParams(params)}`,
    post: vi.fn(async () => ({ state: 'ready', receivedBytes: 1, totalBytes: 1 })),
    get: vi.fn(),
  },
  isLocalApiUrl: (url: string) => url.startsWith('http://127.0.0.1'),
}))

const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }

afterEach(() => { workers.length = 0; vi.unstubAllGlobals() })

describe('K 歌分离调度', () => {
  it('推理会话创建中释放，不会让后续任务永远排队', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => init?.method === 'HEAD'
      ? new Response(null, { status: 404 })
      : new Response(new ArrayBuffer(8))))
    const { createKaraokeSeparator } = await import('./separator')
    const port = createKaraokeSeparator()
    const first = port.separate('local:1', 'http://127.0.0.1/api/local/audio?id=1', () => {}, new AbortController().signal)
    await vi.waitFor(() => expect(workers).toHaveLength(1))
    port.release()
    await expect(first).rejects.toMatchObject({ name: 'AbortError' })
    expect(workers[0].terminate).toHaveBeenCalled()
    // 释放后重新开启：新任务能拿到新的 Worker
    void port.separate('local:2', 'http://127.0.0.1/api/local/audio?id=2', () => {}, new AbortController().signal).catch(() => {})
    await vi.waitFor(() => expect(workers).toHaveLength(2))
    await flush()
    port.release()
  })

  it('已存在的伴奏直接返回，不启动 Worker', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })))
    const { createKaraokeSeparator } = await import('./separator')
    const port = createKaraokeSeparator()
    const url = await port.separate('qq:abc', 'https://cdn.example.com/a.mp3', () => {}, new AbortController().signal)
    expect(url).toContain('/api/karaoke/stem')
    expect(port.knownStem('qq:abc')).toBe(url)
    expect(workers).toHaveLength(0)
  })
})
