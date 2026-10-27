import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SeparatorRequest, SeparatorResponse } from './separator-protocol'

const mocks = vi.hoisted(() => ({
  run: vi.fn(), inputDispose: vi.fn(), outputDispose: vi.fn(),
  createTemporaryWav: vi.fn(), removeTemporaryWav: vi.fn(async () => {}),
}))
vi.mock('onnxruntime-web/webgpu', () => ({
  env: { wasm: {} },
  InferenceSession: { create: async () => ({ inputNames: ['input'], outputNames: ['output'], run: mocks.run }) },
  Tensor: class {
    constructor(_type: string, readonly data: Float32Array) {}
    dispose = mocks.inputDispose
  },
}))
vi.mock('./wav-file', () => ({ createTemporaryWav: mocks.createTemporaryWav, removeTemporaryWav: mocks.removeTemporaryWav }))

let worker: { onmessage: ((event: MessageEvent<SeparatorRequest>) => void) | null; postMessage: ReturnType<typeof vi.fn> }
let writable: { write: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn>; abort: ReturnType<typeof vi.fn> }
let file: { getFile: ReturnType<typeof vi.fn> }

const send = (message: SeparatorRequest) => worker.onmessage!({ data: message } as MessageEvent<SeparatorRequest>)
const completed = () => vi.waitFor(() => {
  const message = worker.postMessage.mock.calls.map(([value]) => value as SeparatorResponse).find(value => value.type === 'done' || value.type === 'error')
  expect(message).toBeDefined()
  return message!
})

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  worker = { onmessage: null, postMessage: vi.fn() }
  vi.stubGlobal('self', worker)
  writable = { write: vi.fn(async () => {}), close: vi.fn(async () => {}), abort: vi.fn(async () => {}) }
  file = { getFile: vi.fn(async () => new Blob([new Uint8Array(8)])) }
  mocks.createTemporaryWav.mockResolvedValue({ file, writable })
  mocks.run.mockImplementation(async ({ input }: { input: { data: Float32Array } }) => ({ output: { getData: async () => input.data, dispose: mocks.outputDispose } }))
  await import('./separator.worker')
  send({ type: 'init', wasm: new ArrayBuffer(0), model: new ArrayBuffer(0), params: { nFft: 4096, dimF: 2048, dimT: 8 } })
  await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledWith({ type: 'ready' }, { transfer: [] }))
  worker.postMessage.mockClear()
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('分离 Worker 文件生命周期', () => {
  it('两块推理之间按上一块耗时留出空档，不连续占用 GPU', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
    mocks.run.mockImplementation(async ({ input }: { input: { data: Float32Array } }) => {
      vi.advanceTimersByTime(400)
      return { output: { getData: async () => input.data, dispose: mocks.outputDispose } }
    })
    send({ type: 'separate', id: 1, left: new Float32Array(3100), right: new Float32Array(3100) })
    for (let i = 0; i < 30; i++) await Promise.resolve()
    expect(mocks.run).toHaveBeenCalledOnce()
    expect(mocks.outputDispose).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1199)
    expect(mocks.run).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1)
    expect(mocks.run).toHaveBeenCalledTimes(2)
    expect(worker.postMessage.mock.calls.some(([value]) => value.type === 'done')).toBe(true)
  })

  it('空档期间取消，不再开始下一块并清理临时输出', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
    mocks.run.mockImplementation(async ({ input }: { input: { data: Float32Array } }) => {
      vi.advanceTimersByTime(400)
      return { output: { getData: async () => input.data, dispose: mocks.outputDispose } }
    })
    send({ type: 'separate', id: 1, left: new Float32Array(3100), right: new Float32Array(3100) })
    for (let i = 0; i < 30; i++) await Promise.resolve()
    expect(mocks.run).toHaveBeenCalledOnce()
    send({ type: 'cancel', id: 1 })
    await vi.advanceTimersByTimeAsync(1200)
    expect(mocks.run).toHaveBeenCalledOnce()
    expect(worker.postMessage.mock.calls.map(([value]) => value)).toContainEqual({ type: 'error', id: 1, message: 'ABORTED' })
    expect(writable.abort).toHaveBeenCalledOnce()
    expect(mocks.removeTemporaryWav).toHaveBeenCalledOnce()
  })

  it('关闭写入流后返回文件，并及时释放每块的推理张量', async () => {
    send({ type: 'separate', id: 1, left: new Float32Array(3100), right: new Float32Array(3100) })
    expect(await completed()).toMatchObject({ type: 'done', id: 1, wav: expect.any(Blob) })
    expect(writable.write).toHaveBeenCalledTimes(3)
    expect(writable.close).toHaveBeenCalledTimes(1)
    expect(writable.close.mock.invocationCallOrder[0]).toBeLessThan(file.getFile.mock.invocationCallOrder[0])
    expect(mocks.inputDispose).toHaveBeenCalledTimes(2)
    expect(mocks.outputDispose).toHaveBeenCalledTimes(2)
    // 上传尚未完成，Worker 不提前删除文件。
    expect(mocks.removeTemporaryWav).not.toHaveBeenCalled()
  })

  it.each(['推理', '写入', '关闭'])('%s 失败时中止写入、清理文件并回报错误', async (phase) => {
    const error = new Error(`${phase}失败`)
    if (phase === '推理') mocks.run.mockRejectedValueOnce(error)
    else if (phase === '写入') writable.write.mockRejectedValueOnce(error)
    else writable.close.mockRejectedValueOnce(error)
    send({ type: 'separate', id: 1, left: new Float32Array(3100), right: new Float32Array(3100) })
    expect(await completed()).toMatchObject({ type: 'error', id: 1, message: `${phase}失败` })
    expect(writable.abort).toHaveBeenCalledTimes(1)
    expect(mocks.removeTemporaryWav).toHaveBeenCalledTimes(1)
    expect(file.getFile).not.toHaveBeenCalled()
    if (phase === '推理') expect(mocks.inputDispose).toHaveBeenCalledTimes(1)
  })

  it('开始写文件时取消任务，不开始推理且删除临时输出', async () => {
    send({ type: 'separate', id: 1, left: new Float32Array(3100), right: new Float32Array(3100) })
    send({ type: 'cancel', id: 1 })
    expect(await completed()).toMatchObject({ type: 'error', id: 1, message: 'ABORTED' })
    expect(mocks.run).not.toHaveBeenCalled()
    expect(writable.abort).toHaveBeenCalledTimes(1)
    expect(mocks.removeTemporaryWav).toHaveBeenCalledTimes(1)
  })

  it('原生模式逐块等待匹配序号的频谱结果，忽略旧响应', async () => {
    send({ type: 'init-native', params: { nFft: 4096, dimF: 2048, dimT: 8 } })
    worker.postMessage.mockClear()
    send({ type: 'separate', id: 2, left: new Float32Array(3100), right: new Float32Array(3100) })
    for (let block = 0; block < 2; block++) {
      const request = await vi.waitFor(() => {
        const calls = worker.postMessage.mock.calls.map(([value]) => value as SeparatorResponse).filter(value => value.type === 'native-infer')
        expect(calls).toHaveLength(block + 1)
        return calls[block] as Extract<SeparatorResponse, { type: 'native-infer' }>
      })
      send({ type: 'native-result', id: 1, sequence: request.sequence, error: '旧任务' })
      send({ type: 'native-result', id: 2, sequence: request.sequence - 1, error: '旧序号' })
      send({ type: 'native-result', id: 2, sequence: request.sequence, spec: request.spec })
    }
    expect(await completed()).toMatchObject({ type: 'done', id: 2 })
    expect(mocks.run).not.toHaveBeenCalled()
  })

  it('原生推理错误中止写入并清理临时文件', async () => {
    send({ type: 'init-native', params: { nFft: 4096, dimF: 2048, dimT: 8 } })
    worker.postMessage.mockClear()
    send({ type: 'separate', id: 2, left: new Float32Array(3100), right: new Float32Array(3100) })
    const request = await vi.waitFor(() => {
      const call = worker.postMessage.mock.calls.find(([value]) => value.type === 'native-infer')
      expect(call).toBeDefined()
      return call![0] as Extract<SeparatorResponse, { type: 'native-infer' }>
    })
    send({ type: 'native-result', id: 2, sequence: request.sequence, error: 'Device lost' })
    expect(await completed()).toMatchObject({ type: 'error', id: 2, message: 'Device lost' })
    expect(writable.abort).toHaveBeenCalledOnce()
    expect(mocks.removeTemporaryWav).toHaveBeenCalledOnce()
  })

  it('等待原生频谱时取消，收到在途回复后也不开始下一块或发布文件', async () => {
    send({ type: 'init-native', params: { nFft: 4096, dimF: 2048, dimT: 8 } })
    worker.postMessage.mockClear()
    send({ type: 'separate', id: 2, left: new Float32Array(3100), right: new Float32Array(3100) })
    const request = await vi.waitFor(() => {
      const call = worker.postMessage.mock.calls.find(([value]) => value.type === 'native-infer')
      expect(call).toBeDefined()
      return call![0] as Extract<SeparatorResponse, { type: 'native-infer' }>
    })
    send({ type: 'cancel', id: 2 })
    send({ type: 'native-result', id: 2, sequence: request.sequence, spec: request.spec })
    expect(await completed()).toMatchObject({ type: 'error', id: 2, message: 'ABORTED' })
    expect(worker.postMessage.mock.calls.filter(([value]) => value.type === 'native-infer')).toHaveLength(1)
    expect(writable.close).not.toHaveBeenCalled()
    expect(writable.abort).toHaveBeenCalledOnce()
    expect(mocks.removeTemporaryWav).toHaveBeenCalledOnce()
    const calls = worker.postMessage.mock.calls.length
    send({ type: 'native-result', id: 2, sequence: request.sequence, spec: request.spec })
    expect(worker.postMessage).toHaveBeenCalledTimes(calls)
  })
})
