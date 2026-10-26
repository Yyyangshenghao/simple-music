import * as ort from 'onnxruntime-web/webgpu'
import { DIM_F, DIM_T, encodeWav, separate } from './mdx'
import type { SeparatorRequest, SeparatorResponse } from './separator-protocol'

/** 分离 Worker：WebGPU 推理与频谱变换都在这里，宿主线程只负责解码和收发。 */
let session: ort.InferenceSession | null = null
const cancelled = new Set<number>()
const post = (message: SeparatorResponse, transfer: Transferable[] = []) => self.postMessage(message, { transfer })

async function init(wasm: ArrayBuffer, model: ArrayBuffer): Promise<void> {
  ort.env.wasm.wasmBinary = wasm
  ort.env.wasm.numThreads = 1
  ort.env.wasm.proxy = false
  session = await ort.InferenceSession.create(new Uint8Array(model), {
    executionProviders: ['webgpu'],
    graphOptimizationLevel: 'all',
  })
}

async function run(id: number, left: Float32Array, right: Float32Array): Promise<void> {
  const active = session
  if (!active) throw new Error('分离模型尚未加载')
  const [input] = active.inputNames
  const [output] = active.outputNames
  const [instL, instR] = await separate(
    left,
    right,
    async (spec) => {
      const result = await active.run({ [input]: new ort.Tensor('float32', spec, [1, 4, DIM_F, DIM_T]) })
      const data = await result[output].getData() as Float32Array
      result[output].dispose()
      return data
    },
    (done, total) => post({ type: 'progress', id, done, total }),
    () => cancelled.has(id),
  )
  const wav = encodeWav(instL, instR)
  post({ type: 'done', id, wav }, [wav])
}

self.onmessage = (event: MessageEvent<SeparatorRequest>) => {
  const message = event.data
  if (message.type === 'cancel') {
    cancelled.add(message.id)
    return
  }
  if (message.type === 'init') {
    init(message.wasm, message.model).then(
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
