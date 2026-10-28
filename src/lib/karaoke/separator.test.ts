import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const workers: FakeWorker[] = []
class FakeWorker {
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: (() => void) | null = null
  posted: unknown[] = []
  transfers: Transferable[][] = []
  terminate = vi.fn()
  constructor() { workers.push(this) }
  postMessage(message: unknown, transfer: Transferable[] = []) { this.posted.push(message); this.transfers.push(transfer) }
}
vi.mock('./separator.worker?worker&inline', () => ({ default: FakeWorker }))
vi.mock('onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url', () => ({ default: 'file:///ort.wasm' }))
vi.mock('./wav-file', () => ({ removeTemporaryWav: vi.fn(async () => {}) }))
vi.mock('../api', () => ({
  api: {
    url: (path: string, params?: Record<string, string>) => `http://127.0.0.1${path}?${new URLSearchParams(params)}`,
    post: vi.fn(async (_path: string, _body: unknown, params?: { model?: string }) => ({
      state: 'ready', receivedBytes: 1, totalBytes: 1,
      precision: params?.model === 'hq3-fp16' ? 'fp16' : 'fp32',
      params: params?.model === 'kara2' ? { nFft: 5120, dimF: 2048, dimT: 256 } : { nFft: 6144, dimF: 3072, dimT: 256 },
    })),
    get: vi.fn(),
  },
  isLocalApiUrl: (url: string) => url.startsWith('http://127.0.0.1'),
}))

const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }

beforeEach(() => vi.stubGlobal('OfflineAudioContext', class { decodeAudioData = async () => ({ length: 4, numberOfChannels: 1, getChannelData: () => new Float32Array(4) }) }))
afterEach(() => { workers.length = 0; vi.unstubAllGlobals() })

describe('K 歌分离调度', () => {
  it('推理会话创建中释放，不会让后续任务永远排队', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => init?.method === 'HEAD'
      ? new Response(null, { status: 404 })
      : new Response(new ArrayBuffer(8))))
    const { createKaraokeSeparator } = await import('./separator')
    const port = createKaraokeSeparator()
    const first = port.separate('hq3', 'local:1', 'http://127.0.0.1/api/local/audio?id=1', () => {}, new AbortController().signal)
    await vi.waitFor(() => expect(workers).toHaveLength(1))
    port.release()
    await expect(first).rejects.toMatchObject({ name: 'AbortError' })
    expect(workers[0].terminate).toHaveBeenCalled()
    // 释放后重新开启：新任务能拿到新的 Worker
    void port.separate('hq3', 'local:2', 'http://127.0.0.1/api/local/audio?id=2', () => {}, new AbortController().signal).catch(() => {})
    await vi.waitFor(() => expect(workers).toHaveLength(2))
    await flush()
    port.release()
  })

  it('已存在的伴奏直接返回，不启动 Worker', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })))
    const { createKaraokeSeparator } = await import('./separator')
    const port = createKaraokeSeparator()
    const url = await port.separate('hq3', 'qq:abc', 'https://cdn.example.com/a.mp3', () => {}, new AbortController().signal)
    expect(url).toContain('/api/karaoke/stem')
    expect(port.knownStem('hq3', 'qq:abc')).toBe(url)
    expect(workers).toHaveLength(0)
  })

  it('换模型时重建 Worker 并带上该模型的参数；同一模型复用', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => init?.method === 'HEAD'
      ? new Response(null, { status: 404 })
      : new Response(new ArrayBuffer(8))))
    vi.stubGlobal('OfflineAudioContext', class { decodeAudioData = async () => ({ numberOfChannels: 1, getChannelData: () => new Float32Array(4) }) })
    const { createKaraokeSeparator } = await import('./separator')
    const port = createKaraokeSeparator()
    const signal = new AbortController().signal
    void port.separate('hq3', 'local:1', 'http://127.0.0.1/a', () => {}, signal).catch(() => {})
    await vi.waitFor(() => expect(workers).toHaveLength(1))
    expect(workers[0].posted[0]).toMatchObject({ type: 'init', params: { nFft: 6144 } })
    workers[0].onmessage!({ data: { type: 'ready' } } as MessageEvent)
    await vi.waitFor(() => expect(workers[0].posted.some((m: any) => m.type === 'separate')).toBe(true))
    const mono = workers[0].posted.find((m: any) => m.type === 'separate') as { left: Float32Array; right: Float32Array }
    expect(mono.left).toEqual(mono.right)
    expect(mono.left.buffer).not.toBe(mono.right.buffer)
    const id = (workers[0].posted.find((m: any) => m.type === 'separate') as { id: number }).id
    workers[0].onmessage!({ data: { type: 'done', id, wav: new ArrayBuffer(8) } } as MessageEvent)
    void port.separate('kara2', 'local:2', 'http://127.0.0.1/b', () => {}, signal).catch(() => {})
    await vi.waitFor(() => expect(workers).toHaveLength(2))
    expect(workers[0].terminate).toHaveBeenCalled()
    expect(workers[1].posted[0]).toMatchObject({ type: 'init', params: { nFft: 5120, dimF: 2048 } })
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/api/karaoke/model/file?model=kara2'))).toBe(true)
    port.release()
  })

  it('显卡不支持 shader-f16 时 fp16 模型直接报错，不启动 Worker', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => init?.method === 'HEAD'
      ? new Response(null, { status: 404 })
      : new Response(new ArrayBuffer(8))))
    vi.stubGlobal('navigator', { gpu: { requestAdapter: async () => ({ features: new Set<string>() }) } })
    const { createKaraokeSeparator } = await import('./separator')
    const port = createKaraokeSeparator()
    await expect(port.separate('hq3-fp16', 'local:1', 'http://127.0.0.1/a', () => {}, new AbortController().signal)).rejects.toThrow('半精度')
    expect(workers).toHaveLength(0)
  })

  it.each([200, 500])('直接转移立体声 PCM，以文件上传并清理临时输出（HTTP %i）', async (status) => {
    const left = new Float32Array([0.1, 0.2]), right = new Float32Array([0.3, 0.4])
    vi.stubGlobal('OfflineAudioContext', class {
      decodeAudioData = async () => ({ length: 2, numberOfChannels: 2, getChannelData: (channel: number) => channel ? right : left })
    })
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => init?.method === 'HEAD'
      ? new Response(null, { status: 404 })
      : init?.method === 'POST' ? new Response(null, { status }) : new Response(new ArrayBuffer(8))))
    const { removeTemporaryWav } = await import('./wav-file')
    vi.mocked(removeTemporaryWav).mockClear()
    const { createKaraokeSeparator } = await import('./separator')
    const port = createKaraokeSeparator()
    const pending = port.separate('hq3', 'local:pcm', 'http://127.0.0.1/a', () => {}, new AbortController().signal)
    await vi.waitFor(() => expect(workers).toHaveLength(1))
    const worker = workers[0]
    worker.onmessage!({ data: { type: 'ready' } } as MessageEvent)
    await vi.waitFor(() => expect(worker.posted).toHaveLength(2))
    const message = worker.posted[1] as { id: number; left: Float32Array; right: Float32Array }
    expect(message.left).toBe(left)
    expect(message.right).toBe(right)
    expect(worker.transfers[1]).toEqual([left.buffer, right.buffer])
    const wav = new Blob([new Uint8Array(48)], { type: 'audio/wav' })
    worker.onmessage!({ data: { type: 'done', id: message.id, wav } } as MessageEvent)
    if (status === 200) await expect(pending).resolves.toContain('/api/karaoke/stem')
    else await expect(pending).rejects.toThrow('伴奏保存失败')
    expect(vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'POST')?.[1]?.body).toBe(wav)
    expect(removeTemporaryWav).toHaveBeenCalledTimes(1)
    port.release()
  })

  it('文件上传期间取消，也等待临时文件清理后结束任务', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'HEAD') return new Response(null, { status: 404 })
      if (init?.method === 'POST') return new Promise<Response>((_resolve, reject) => {
        init.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
      })
      return new Response(new ArrayBuffer(8))
    }))
    const { removeTemporaryWav } = await import('./wav-file')
    vi.mocked(removeTemporaryWav).mockClear()
    const { createKaraokeSeparator } = await import('./separator')
    const port = createKaraokeSeparator()
    const controller = new AbortController()
    const pending = port.separate('hq3', 'local:cancel', 'http://127.0.0.1/a', () => {}, controller.signal)
    const aborted = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(workers).toHaveLength(1))
    workers[0].onmessage!({ data: { type: 'ready' } } as MessageEvent)
    await vi.waitFor(() => expect(workers[0].posted).toHaveLength(2))
    const { id } = workers[0].posted[1] as { id: number }
    workers[0].onmessage!({ data: { type: 'done', id, wav: new Blob([new Uint8Array(48)]) } } as MessageEvent)
    await vi.waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true))
    controller.abort()
    await aborted
    expect(removeTemporaryWav).toHaveBeenCalledTimes(1)
    port.release()
  })

  it.each([true, false])('优先尝试原生推理；不可用时恢复原 Worker 路径（原生 %s）', async (native) => {
    const bridge = { initNative: vi.fn(async () => native), inferNative: vi.fn(async (spec: Float32Array) => spec.slice()) }
    vi.stubGlobal('window', { karaokeHelper: bridge })
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => init?.method === 'HEAD'
      ? new Response(null, { status: 404 }) : new Response(new ArrayBuffer(8))))
    const { createKaraokeSeparator } = await import('./separator')
    const port = createKaraokeSeparator()
    const pending = port.separate('hq3', 'local:native', 'http://127.0.0.1/a', () => {}, new AbortController().signal)
    await vi.waitFor(() => expect(workers).toHaveLength(1))
    const worker = workers[0]
    expect(worker.posted[0]).toMatchObject({ type: native ? 'init-native' : 'init' })
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/api/karaoke/model/file'))).toBe(!native)
    worker.onmessage!({ data: { type: 'ready' } } as MessageEvent)
    await vi.waitFor(() => expect(worker.posted).toHaveLength(2))
    const { id } = worker.posted[1] as { id: number }
    if (native) {
      const spec = new Float32Array(4)
      worker.onmessage!({ data: { type: 'native-infer', id, sequence: 7, spec } } as MessageEvent)
      await vi.waitFor(() => expect(worker.posted).toHaveLength(3))
      expect(bridge.inferNative).toHaveBeenCalledWith(spec)
      expect(worker.posted[2]).toMatchObject({ type: 'native-result', id, sequence: 7, spec })
      expect(worker.transfers[2]).toHaveLength(1)
    } else expect(bridge.inferNative).not.toHaveBeenCalled()
    worker.onmessage!({ data: { type: 'done', id, wav: new Blob([new Uint8Array(48)]) } } as MessageEvent)
    await expect(pending).resolves.toContain('/api/karaoke/stem')
    port.release()
  })

  it('原生初始化发生释放错误时结束任务，避免同时加载浏览器 GPU 会话', async () => {
    vi.stubGlobal('window', { karaokeHelper: { initNative: vi.fn(async () => { throw new Error('Release failed') }) } })
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => init?.method === 'HEAD'
      ? new Response(null, { status: 404 }) : new Response(new ArrayBuffer(8))))
    const { createKaraokeSeparator } = await import('./separator')
    await expect(createKaraokeSeparator().separate('hq3', 'local:fail', 'http://127.0.0.1/a', () => {}, new AbortController().signal)).rejects.toThrow('Release failed')
    expect(workers).toHaveLength(0)
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/api/karaoke/model/file'))).toBe(false)
  })
})
