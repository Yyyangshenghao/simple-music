import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  file: vi.fn(), backends: vi.fn(), create: vi.fn(), run: vi.fn(), release: vi.fn(async () => {}),
  inputDispose: vi.fn(), outputDispose: vi.fn(),
}))
vi.mock('../../server/lib/karaoke-store', () => ({
  karaokeModelInfo: () => ({ id: 'hq3', params: { dimF: 1, dimT: 1 } }), karaokeModelFile: h.file,
}))
vi.mock('onnxruntime-node', () => ({
  listSupportedBackends: h.backends, InferenceSession: { create: h.create },
  Tensor: class { constructor(_type: string, readonly data: Float32Array) {} dispose = h.inputDispose },
}))
import { createNativeInference } from './karaoke-native'

beforeEach(() => {
  vi.clearAllMocks()
  h.file.mockResolvedValue({ path: '/models/hq3.onnx' })
  h.backends.mockReturnValue([{ name: 'webgpu', bundled: true }])
  h.create.mockResolvedValue({ inputNames: ['input'], outputNames: ['output'], run: h.run, release: h.release })
  h.run.mockResolvedValue({ output: { getData: async () => new Float32Array([1, 2, 3, 4]), dispose: h.outputDispose } })
})

describe('原生 GPU 分离会话', () => {
  it('使用已安装模型，明确禁用静默 CPU 回退，完成后释放张量', async () => {
    const engine = createNativeInference('/profile')
    expect(h.create).not.toHaveBeenCalled()
    expect(await engine.init('hq3')).toBe(true)
    expect(h.create).toHaveBeenCalledWith('/models/hq3.onnx', expect.objectContaining({
      executionProviders: [{ name: 'webgpu', storageBufferCacheMode: 'lazyRelease' }],
      extra: { session: { disable_cpu_ep_fallback: '1' } },
    }))
    expect(await engine.infer(new Float32Array(4))).toEqual(new Float32Array([1, 2, 3, 4]))
    expect(h.inputDispose).toHaveBeenCalledOnce()
    expect(h.outputDispose).toHaveBeenCalledOnce()
  })

  it('模型不存在或没有原生 GPU 后端时返回不可用', async () => {
    const engine = createNativeInference('/profile')
    h.file.mockResolvedValueOnce(null)
    expect(await engine.init('hq3')).toBe(false)
    h.backends.mockReturnValueOnce([{ name: 'cpu', bundled: true }])
    expect(await engine.init('hq3')).toBe(false)
    expect(h.create).not.toHaveBeenCalled()
  })

  it('驱动或模型初始化失败时允许浏览器后端接管', async () => {
    h.create.mockRejectedValueOnce(new Error('No adapter'))
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try { expect(await createNativeInference('/profile').init('hq3')).toBe(false) } finally { log.mockRestore() }
  })

  it('旧会话释放失败时不继续创建新会话或宣称可以回退', async () => {
    const engine = createNativeInference('/profile')
    await engine.init('hq3')
    h.release.mockRejectedValueOnce(new Error('Release failed'))
    await expect(engine.init('hq3')).rejects.toThrow('Release failed')
    expect(h.create).toHaveBeenCalledOnce()
  })

  it('拒绝未初始化、错误尺寸及带有额外底层数据的频谱', async () => {
    const engine = createNativeInference('/profile')
    await expect(engine.infer(new Float32Array(4))).rejects.toThrow('尚未初始化')
    await engine.init('hq3')
    await expect(engine.infer(new Float32Array(3))).rejects.toThrow('无效')
    await expect(engine.infer(new Float32Array(8).subarray(0, 4))).rejects.toThrow('无效')
    expect(h.run).not.toHaveBeenCalled()
  })

  it('输出视图也只保留当前频谱，拒绝尺寸错误的输出', async () => {
    const engine = createNativeInference('/profile')
    await engine.init('hq3')
    h.run.mockResolvedValueOnce({ output: { getData: async () => new Float32Array(16).subarray(1, 5), dispose: h.outputDispose } })
    const result = await engine.infer(new Float32Array(4))
    expect(result.byteOffset).toBe(0)
    expect(result.buffer.byteLength).toBe(16)
    h.run.mockResolvedValueOnce({ output: { getData: async () => new Float32Array(3), dispose: h.outputDispose } })
    await expect(engine.infer(new Float32Array(4))).rejects.toThrow('输出格式')
    expect(h.outputDispose).toHaveBeenCalledTimes(2)
  })

  it('同一时间只执行一块；推理失败后可释放旧模型并重新初始化', async () => {
    const engine = createNativeInference('/profile')
    await engine.init('hq3')
    let fail!: (error: Error) => void
    h.run.mockReturnValueOnce(new Promise((_resolve, reject) => { fail = reject }))
    const first = engine.infer(new Float32Array(4))
    const failed = expect(first).rejects.toThrow('Device lost')
    await expect(engine.infer(new Float32Array(4))).rejects.toThrow('正在执行')
    await expect(engine.init('hq3')).rejects.toThrow('正在处理')
    fail(new Error('Device lost'))
    await failed
    expect(h.inputDispose).toHaveBeenCalledOnce()
    expect(await engine.init('hq3')).toBe(true)
    expect(h.release).toHaveBeenCalledOnce()
  })
})
