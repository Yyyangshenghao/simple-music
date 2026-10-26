import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url'
import SeparatorWorker from './separator.worker?worker&inline'
import { api, isLocalApiUrl } from '../api'
import { SAMPLE_RATE } from './mdx'
import type { SeparatorRequest, SeparatorResponse } from './separator-protocol'
import type { KaraokePort, KaraokeProgress } from '../playback-core'

interface ModelStatus {
  state: 'missing' | 'downloading' | 'ready' | 'error'
  receivedBytes: number
  totalBytes: number
  error?: string
}

const MODEL_POLL_MS = 500

type GpuNavigator = Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }

const abortError = () => new DOMException('Aborted', 'AbortError')

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => { clearTimeout(timer); reject(abortError()) }, { once: true })
  })
}

/**
 * 宿主侧 AI 分离：负责模型下载、解码与伴奏上传，推理交给内联 Worker。
 * 同一时间只跑一首，Worker 在关闭 K 歌时释放以归还显存。
 */
export function createKaraokeSeparator(): KaraokePort {
  const known = new Map<string, string>()
  let support: Promise<boolean> | null = null
  let worker: Worker | null = null
  let ready: Promise<Worker> | null = null
  let nextId = 0
  let queue: Promise<unknown> = Promise.resolve()

  /** 等待 Worker 回复的调用；释放 Worker 后它不会再回消息，统一以中止结束，避免队列卡死。 */
  const waiters = new Set<(error: Error) => void>()
  /** 模型下载进度转给当前正在等待的任务，而不是最早触发下载的那首。 */
  let modelListener: ((p: KaraokeProgress) => void) | null = null
  let modelAbort = new AbortController()

  const stemUrl = (key: string) => api.url('/api/karaoke/stem', { key })

  function awaitWorker<T>(executor: (resolve: (value: T) => void, reject: (error: Error) => void) => void): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const fail = (error: Error) => { waiters.delete(fail); reject(error) }
      waiters.add(fail)
      executor((value) => { waiters.delete(fail); resolve(value) }, fail)
    })
  }

  async function ensureModel(signal: AbortSignal): Promise<void> {
    let status = await api.post<ModelStatus>('/api/karaoke/model', undefined, undefined, { signal })
    while (status.state === 'downloading') {
      modelListener?.({ phase: 'model', progress: status.totalBytes ? status.receivedBytes / status.totalBytes : 0 })
      await wait(MODEL_POLL_MS, signal)
      status = await api.get<ModelStatus>('/api/karaoke/model', undefined, { signal })
    }
    if (status.state !== 'ready') throw new Error(status.error || '模型下载失败')
  }

  /** 加载模型与推理会话；不跟随单首任务取消，只在释放时中止。 */
  function startWorker(): Promise<Worker> {
    if (ready) return ready
    const signal = modelAbort.signal
    const starting = (async () => {
      await ensureModel(signal)
      const [model, wasm] = await Promise.all([
        fetch(api.url('/api/karaoke/model/file'), { signal }).then(res => res.arrayBuffer()),
        fetch(wasmUrl, { signal }).then(res => res.arrayBuffer()),
      ])
      if (signal.aborted) throw abortError()
      const created = new SeparatorWorker()
      worker = created
      await awaitWorker<void>((resolve, reject) => {
        created.onmessage = (event: MessageEvent<SeparatorResponse>) => {
          if (event.data.type === 'ready') resolve()
          else if (event.data.type === 'error') reject(new Error(event.data.message))
        }
        created.onerror = () => reject(new Error('分离引擎启动失败'))
        created.postMessage({ type: 'init', wasm, model } satisfies SeparatorRequest, [wasm, model])
      })
      return created
    })()
    ready = starting
    starting.catch(() => { if (ready === starting) release() })
    return starting
  }

  async function decode(src: string, signal: AbortSignal): Promise<[Float32Array, Float32Array]> {
    // 上游地址经音频代理读取（不带缓存键，避免与正在播放的缓存写入抢锁）；本地 API 地址直接读
    const url = /^https?:\/\//i.test(src) && !isLocalApiUrl(src) ? api.url('/api/audio', { url: src }) : src
    const res = await fetch(url, { signal })
    if (!res.ok) throw new Error(`读取音频失败（HTTP ${res.status}）`)
    // 离线上下文解码时按其采样率重采样，模型只接受 44.1kHz
    const buffer = await new OfflineAudioContext(2, 1, SAMPLE_RATE).decodeAudioData(await res.arrayBuffer())
    const left = buffer.getChannelData(0).slice()
    const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1).slice() : left.slice()
    return [left, right]
  }

  /** 取消时等 Worker 在块间确认后才结束，保证同一会话上不会有两次推理并发。 */
  function infer(target: Worker, left: Float32Array, right: Float32Array, onProgress: (p: KaraokeProgress) => void, signal: AbortSignal): Promise<ArrayBuffer> {
    const id = ++nextId
    return awaitWorker<ArrayBuffer>((resolve, reject) => {
      const onAbort = () => target.postMessage({ type: 'cancel', id } satisfies SeparatorRequest)
      signal.addEventListener('abort', onAbort, { once: true })
      target.onerror = () => {
        signal.removeEventListener('abort', onAbort)
        reject(new Error('分离引擎异常退出'))
      }
      target.onmessage = (event: MessageEvent<SeparatorResponse>) => {
        const message = event.data
        if (!('id' in message) || message.id !== id) return
        if (message.type === 'progress') onProgress({ phase: 'separating', progress: message.done / message.total })
        else {
          signal.removeEventListener('abort', onAbort)
          if (message.type === 'done') resolve(message.wav)
          else reject(message.message === 'ABORTED' ? abortError() : new Error(message.message))
        }
      }
      target.postMessage({ type: 'separate', id, left, right } satisfies SeparatorRequest, [left.buffer, right.buffer])
    })
  }

  async function run(key: string, src: string, onProgress: (p: KaraokeProgress) => void, signal: AbortSignal): Promise<string> {
    const cached = known.get(key)
    if (cached) return cached
    const head = await fetch(stemUrl(key), { method: 'HEAD', signal }).catch(() => null)
    if (head?.ok) {
      known.set(key, stemUrl(key))
      return stemUrl(key)
    }
    modelListener = onProgress
    const target = await startWorker()
    if (modelListener === onProgress) modelListener = null
    if (signal.aborted) throw abortError()
    onProgress({ phase: 'separating', progress: 0 })
    const [left, right] = await decode(src, signal)
    const wav = await infer(target, left, right, onProgress, signal)
    const saved = await fetch(stemUrl(key), { method: 'POST', body: wav, headers: { 'Content-Type': 'audio/wav' }, signal })
    if (!saved.ok) throw new Error('伴奏保存失败')
    known.set(key, stemUrl(key))
    return stemUrl(key)
  }

  function release(): void {
    modelAbort.abort()
    modelAbort = new AbortController()
    worker?.terminate()
    worker = null
    ready = null
    for (const fail of [...waiters]) fail(abortError())
  }

  return {
    supported() {
      support ??= (async () => !!(await (navigator as GpuNavigator).gpu?.requestAdapter().catch(() => null)))()
      return support
    },
    knownStem: key => known.get(key) ?? null,
    forget(key) { known.delete(key) },
    separate(key, src, onProgress, signal) {
      // 串行执行：上一首取消后才开始下一首，单个会话不并发推理
      const job = queue.catch(() => {}).then(() => {
        if (signal.aborted) throw abortError()
        return run(key, src, onProgress, signal)
      })
      queue = job
      return job
    },
    release,
  }
}
