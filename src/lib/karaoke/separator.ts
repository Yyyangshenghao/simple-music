import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url'
import SeparatorWorker from './separator.worker?worker&inline'
import { api, isLocalApiUrl } from '../api'
import { SAMPLE_RATE } from './mdx'
import { removeTemporaryWav } from './wav-file'
import type { SeparatorRequest, SeparatorResponse } from './separator-protocol'
import type { KaraokePort, KaraokeProgress } from '../../types/karaoke'
import type { KaraokeModelId, KaraokeModelParams, KaraokeModelState } from '../../types/karaoke'
import type { KaraokeHelperBridge } from '../../../electron/preload/karaoke-helper'

interface ModelStatus {
  state: KaraokeModelState
  receivedBytes: number
  totalBytes: number
  error?: string
  params: KaraokeModelParams
  precision: 'fp32' | 'fp16'
}

const MODEL_POLL_MS = 500

type GpuNavigator = Navigator & { gpu?: { requestAdapter(): Promise<{ features: { has(name: string): boolean } } | null> } }

const abortError = () => new DOMException('Aborted', 'AbortError')

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => { clearTimeout(timer); reject(abortError()) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve() }, ms)
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * AI 分离（运行在独立的 K 歌分离进程页面里）：负责模型下载、解码与伴奏上传；Worker 分块，优先通过私有桥调用原生 GPU。
 * 同一时间只跑一首，换模型时重建 Worker；任务结束后由主进程退出分离实例以归还资源。
 */
export function createKaraokeSeparator(): KaraokePort {
  const nativeBridge = typeof window === 'undefined' ? undefined : (window as unknown as { karaokeHelper?: KaraokeHelperBridge }).karaokeHelper
  const known = new Map<string, string>()
  let support: Promise<boolean> | null = null
  let worker: Worker | null = null
  let ready: Promise<Worker> | null = null
  let readyModel: KaraokeModelId | null = null
  let nextId = 0
  let queue: Promise<unknown> = Promise.resolve()

  /** 等待 Worker 回复的调用；释放 Worker 后它不会再回消息，统一以中止结束，避免队列卡死。 */
  const waiters = new Set<(error: Error) => void>()
  /** 模型下载进度转给当前正在等待的任务，而不是最早触发下载的那首。 */
  let modelListener: ((p: KaraokeProgress) => void) | null = null
  let modelAbort = new AbortController()

  const stemUrl = (model: KaraokeModelId, key: string) => api.url('/api/karaoke/stem', { model, key })
  const knownId = (model: KaraokeModelId, key: string) => `${model}|${key}`
  const remember = (id: string, url: string) => {
    known.delete(id)
    known.set(id, url)
    if (known.size > 256) known.delete(known.keys().next().value!)
  }

  function awaitWorker<T>(executor: (resolve: (value: T) => void, reject: (error: Error) => void) => void): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const fail = (error: Error) => { waiters.delete(fail); reject(error) }
      waiters.add(fail)
      executor((value) => { waiters.delete(fail); resolve(value) }, fail)
    })
  }

  async function ensureModel(model: KaraokeModelId, signal: AbortSignal): Promise<ModelStatus> {
    let status = await api.post<ModelStatus>('/api/karaoke/model', undefined, { model }, { signal })
    while (status.state === 'downloading') {
      modelListener?.({ phase: 'model', progress: status.totalBytes ? status.receivedBytes / status.totalBytes : 0 })
      await wait(MODEL_POLL_MS, signal)
      status = await api.get<ModelStatus>('/api/karaoke/model', { model }, { signal })
    }
    if (status.state !== 'ready') throw new Error(status.error || '模型下载失败')
    return status
  }

  async function supportsF16(): Promise<boolean> {
    const adapter = await (navigator as GpuNavigator).gpu?.requestAdapter().catch(() => null)
    return !!adapter?.features.has('shader-f16')
  }

  /** 加载模型与推理会话；不跟随单首任务取消，只在释放时中止。 */
  function startWorker(id: KaraokeModelId): Promise<Worker> {
    if (ready && readyModel === id) return ready
    // 任务串行执行，此时旧模型没有在途推理，可直接换掉
    if (ready) release()
    const signal = modelAbort.signal
    const starting = (async () => {
      const status = await ensureModel(id, signal)
      modelListener?.({ phase: 'preparing', progress: 0 })
      const useNative = !!nativeBridge?.initNative && await nativeBridge.initNative(id)
      if (signal.aborted) throw abortError()
      if (!useNative && status.precision === 'fp16' && !(await supportsF16())) throw new Error('显卡不支持半精度模型，请在设置中换用 HQ3 标准')
      const binary = async (url: string) => {
        const response = await fetch(url, { signal })
        if (!response.ok) throw new Error('分离引擎文件读取失败，请检查模型是否已安装')
        return response.arrayBuffer()
      }
      const binaries = useNative ? null : await Promise.all([binary(api.url('/api/karaoke/model/file', { model: id })), binary(wasmUrl)])
      if (signal.aborted) throw abortError()
      const created = new SeparatorWorker()
      worker = created
      await awaitWorker<void>((resolve, reject) => {
        created.onmessage = (event: MessageEvent<SeparatorResponse>) => {
          if (event.data.type === 'ready') resolve()
          else if (event.data.type === 'error') reject(new Error(event.data.message))
        }
        created.onerror = () => reject(new Error('分离引擎启动失败'))
        if (binaries) {
          const [model, wasm] = binaries
          created.postMessage({ type: 'init', wasm, model, params: status.params } satisfies SeparatorRequest, [wasm, model])
        } else created.postMessage({ type: 'init-native', params: status.params } satisfies SeparatorRequest)
      })
      return created
    })()
    ready = starting
    readyModel = id
    starting.catch(() => { if (ready === starting) release() })
    return starting
  }

  async function decode(src: string, signal: AbortSignal): Promise<[Float32Array, Float32Array]> {
    // 上游地址经音频代理读取（不带缓存键，避免与正在播放的缓存写入抢锁）；本地 API 地址直接读
    const url = /^https?:\/\//i.test(src) && !isLocalApiUrl(src) ? api.url('/api/audio', { url: src }) : src
    const res = await fetch(url, { signal })
    if (!res.ok) throw new Error(`读取音频失败（HTTP ${res.status}）`)
    // 在解码前限制输入，避免大体积文件把压缩音频和 PCM 一起堆满内存。
    const limit = 128 * 1024 * 1024
    if (Number(res.headers.get('Content-Length')) > limit) throw new Error('音频文件超过 128 MB，暂不支持生成伴奏')
    const reader = res.body?.getReader()
    if (!reader) throw new Error('音频读取失败')
    let chunks: Uint8Array[] = []
    let size = 0
    try {
      while (true) {
        signal.throwIfAborted()
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > limit) throw new Error('音频文件超过 128 MB，暂不支持生成伴奏')
        chunks.push(value)
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    chunks = []
    // 离线上下文解码时按其采样率重采样，模型只接受 44.1kHz
    const buffer = await new OfflineAudioContext(2, 1, SAMPLE_RATE).decodeAudioData(bytes.buffer)
    signal.throwIfAborted()
    if (buffer.length > SAMPLE_RATE * 30 * 60) throw new Error('暂不支持超过 30 分钟的音频')
    // 声道缓冲区直接转移给 Worker；只有单声道需要复制成独立的右声道，避免整首 PCM 再复制一份。
    const left = buffer.getChannelData(0)
    const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left.slice()
    return [left, right]
  }

  /** 取消时等 Worker 在块间确认后才结束，保证同一会话上不会有两次推理并发。 */
  function infer(target: Worker, left: Float32Array, right: Float32Array, onProgress: (p: KaraokeProgress) => void, signal: AbortSignal): Promise<Blob> {
    const id = ++nextId
    return awaitWorker<Blob>((resolve, reject) => {
      const onAbort = () => target.postMessage({ type: 'cancel', id } satisfies SeparatorRequest)
      signal.addEventListener('abort', onAbort, { once: true })
      target.onerror = () => {
        signal.removeEventListener('abort', onAbort)
        reject(new Error('分离引擎异常退出'))
      }
      target.onmessage = (event: MessageEvent<SeparatorResponse>) => {
        const message = event.data
        if (!('id' in message) || message.id !== id) return
        if (message.type === 'native-infer') {
          const reply = (spec?: Float32Array, error?: string) => {
            if (worker !== target) return
            target.postMessage({ type: 'native-result', id, sequence: message.sequence, spec, error } satisfies SeparatorRequest, spec ? [spec.buffer] : [])
          }
          void Promise.resolve().then(() => nativeBridge!.inferNative(message.spec)).then(
            spec => reply(spec),
            error => reply(undefined, error instanceof Error ? error.message : String(error)),
          )
          return
        }
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

  async function run(model: KaraokeModelId, key: string, src: string, onProgress: (p: KaraokeProgress) => void, signal: AbortSignal): Promise<string> {
    const url = stemUrl(model, key)
    const cached = known.get(knownId(model, key))
    if (cached) return cached
    const head = await fetch(url, { method: 'HEAD', signal }).catch(() => null)
    if (head?.ok) {
      remember(knownId(model, key), url)
      return url
    }
    if (model === 'hq3-fp16' && !nativeBridge?.initNative && !(await supportsF16())) throw new Error('显卡不支持半精度模型，请在设置中换用 HQ3 标准')
    modelListener = onProgress
    onProgress({ phase: 'decoding', progress: 0 })
    const [left, right] = await decode(src, signal)
    // 解码完成后才加载推理会话，避开解码临时数据与模型初始化的重叠峰值。
    const target = await startWorker(model)
    if (modelListener === onProgress) modelListener = null
    if (signal.aborted) throw abortError()
    onProgress({ phase: 'separating', progress: 0 })
    try {
      const wav = await infer(target, left, right, onProgress, signal)
      signal.throwIfAborted()
      onProgress({ phase: 'saving', progress: 0 })
      // File 由磁盘按需读取，上传过程中也不把整首 WAV 读回内存。
      const saved = await fetch(url, { method: 'POST', body: wav, headers: { 'Content-Type': 'audio/wav' }, signal })
      if (!saved.ok) throw new Error('伴奏保存失败')
    } finally {
      await removeTemporaryWav().catch(() => {})
    }
    remember(knownId(model, key), url)
    return url
  }

  function release(): void {
    modelAbort.abort()
    modelAbort = new AbortController()
    worker?.terminate()
    worker = null
    ready = null
    readyModel = null
    for (const fail of [...waiters]) fail(abortError())
  }

  return {
    supported() {
      support ??= (async () => !!(await (navigator as GpuNavigator).gpu?.requestAdapter().catch(() => null)))()
      return support
    },
    knownStem: (model, key) => known.get(knownId(model, key)) ?? null,
    forget(model, key) { known.delete(knownId(model, key)) },
    separate(model, key, src, onProgress, signal) {
      // 串行执行：上一首取消后才开始下一首，单个会话不并发推理
      const job = queue.catch(() => {}).then(() => {
        if (signal.aborted) throw abortError()
        return run(model, key, src, onProgress, signal)
      })
      queue = job
      return job
    },
    release,
  }
}
