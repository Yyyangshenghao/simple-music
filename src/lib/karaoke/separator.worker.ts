import * as ort from 'onnxruntime-web/webgpu'
import { createMdx, separateToWavStream, type Mdx } from './mdx'
import { createTemporaryWav, removeTemporaryWav } from './wav-file'
import type { SeparatorRequest, SeparatorResponse } from './separator-protocol'

/** 分离 Worker：频谱变换与逐块写盘；优先请求原生推理，不可用时使用 Worker WebGPU。 */
let session: ort.InferenceSession | null = null
let mdx: Mdx | null = null
let native = false
let sequence = 0
let pending: { id: number; sequence: number; resolve(spec: Float32Array): void; reject(error: Error): void } | null = null
const cancelled = new Set<number>()
const post = (message: SeparatorResponse, transfer: Transferable[] = []) => self.postMessage(message, { transfer })

async function init(wasm: ArrayBuffer, model: ArrayBuffer, params: Parameters<typeof createMdx>[0]): Promise<void> {
  mdx = createMdx(params)
  ort.env.wasm.wasmBinary = wasm
  ort.env.wasm.numThreads = 1
  ort.env.wasm.proxy = false
  session = await ort.InferenceSession.create(new Uint8Array(model), {
    // 默认 bucket 模式会一直缓存中间张量（单个约 150MB），显存常驻近 1.9GB；lazyRelease 每次推理后归还，只慢约 3%
    executionProviders: [{ name: 'webgpu', storageBufferCacheMode: 'lazyRelease' }],
    graphOptimizationLevel: 'all',
  })
}

async function run(id: number, left: Float32Array, right: Float32Array): Promise<void> {
  const active = session
  const processing = mdx
  if ((!active && !native) || !processing) throw new Error('分离模型尚未加载')
  const { dimF, dimT } = processing.params
  const input = active?.inputNames[0]
  const output = active?.outputNames[0]
  let nextInferenceAt = 0
  const { file, writable } = await createTemporaryWav()
  try {
    await separateToWavStream(
      processing,
      left,
      right,
      async (spec) => {
        const rest = nextInferenceAt - performance.now()
        if (rest > 0) await new Promise(resolve => setTimeout(resolve, rest))
        if (cancelled.has(id)) throw new DOMException('Aborted', 'AbortError')
        const started = performance.now()
        try {
          if (native) return await new Promise<Float32Array>((resolve, reject) => {
            const next = ++sequence
            pending = { id, sequence: next, resolve, reject }
            // input 会在下一块复用，保留其所有权；单次仅发送一块模型频谱。
            post({ type: 'native-infer', id, sequence: next, spec })
          })
          const tensor = new ort.Tensor('float32', spec, [1, 4, dimF, dimT])
          let result: Awaited<ReturnType<ort.InferenceSession['run']>> | undefined
          try {
            result = await active!.run({ [input!]: tensor })
            return await result[output!].getData() as Float32Array
          } finally {
            tensor.dispose()
            for (const value of Object.values(result ?? {})) value.dispose()
          }
        } finally {
          // 独立进程仍共享物理 GPU。前后处理计入空档，不连续提交下一块抢占界面合成。
          const finished = performance.now()
          nextInferenceAt = finished + Math.max(100, Math.min(1500, (finished - started) * 3))
        }
      },
      chunk => writable.write(chunk),
      (done, total) => post({ type: 'progress', id, done, total }),
      () => cancelled.has(id),
    )
    await writable.close()
    post({ type: 'done', id, wav: await file.getFile() })
  } catch (error) {
    await writable.abort().catch(() => {})
    await removeTemporaryWav().catch(() => {})
    throw error
  }
}

self.onmessage = (event: MessageEvent<SeparatorRequest>) => {
  const message = event.data
  if (message.type === 'native-result') {
    if (pending?.id !== message.id || pending.sequence !== message.sequence) return
    const waiting = pending
    pending = null
    if (message.spec) waiting.resolve(message.spec)
    else waiting.reject(new Error(message.error || '原生推理失败'))
    return
  }
  if (message.type === 'init-native') {
    mdx = createMdx(message.params)
    native = true
    post({ type: 'ready' })
    return
  }
  if (message.type === 'cancel') {
    cancelled.add(message.id)
    return
  }
  if (message.type === 'init') {
    init(message.wasm, message.model, message.params).then(
      () => post({ type: 'ready' }),
      (error: unknown) => post({ type: 'error', id: 0, message: error instanceof Error ? error.message : String(error) }),
    )
    return
  }
  run(message.id, message.left, message.right).catch((error: unknown) => {
    const aborted = error instanceof DOMException && error.name === 'AbortError'
    post({ type: 'error', id: message.id, message: aborted ? 'ABORTED' : error instanceof Error ? error.message : String(error) })
  }).finally(() => cancelled.delete(message.id))
}
