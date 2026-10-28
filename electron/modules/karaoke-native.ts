import type { InferenceSession, Tensor } from 'onnxruntime-node'
import { karaokeModelFile, karaokeModelInfo } from '../../server/lib/karaoke-store'
import type { KaraokeModelId } from '../../src/types/karaoke'

/** 只在独立分离实例按需加载原生 GPU；播放器主实例不加载原生运行库。 */
export function createNativeInference(userDataDir: string) {
  let session: InferenceSession | null = null
  let ort: typeof import('onnxruntime-node') | null = null
  let shape: number[] = []
  let busy = false

  return {
    async init(id: KaraokeModelId): Promise<boolean> {
      if (busy) throw new Error('分离引擎正在处理任务')
      busy = true
      try {
        const previous = session
        session = null
        // 旧会话释放失败时让整个任务失败，不能带着它再启动另一套 GPU 引擎。
        if (previous) await previous.release()
        try {
          const model = karaokeModelInfo(id)!
          const file = await karaokeModelFile(userDataDir, model)
          if (!file) return false
          ort ??= await import('onnxruntime-node')
          if (!ort.listSupportedBackends().some(backend => backend.name === 'webgpu' && backend.bundled)) return false
          session = await ort.InferenceSession.create(file.path, {
            executionProviders: [{ name: 'webgpu', storageBufferCacheMode: 'lazyRelease' }],
            graphOptimizationLevel: 'all', enableCpuMemArena: false, enableMemPattern: false,
            intraOpNumThreads: 1, interOpNumThreads: 1,
            extra: { session: { disable_cpu_ep_fallback: '1' } },
          })
          shape = [1, 4, model.params.dimF, model.params.dimT]
          return true
        } catch (error) {
          const failed = session
          session = null
          if (failed) await failed.release()
          console.warn('[Karaoke] 原生 GPU 不可用，使用浏览器分离引擎', error instanceof Error ? error.message : String(error))
          return false
        }
      } finally { busy = false }
    },
    async infer(input: Float32Array): Promise<Float32Array> {
      const active = session
      if (!active || !ort) throw new Error('原生分离引擎尚未初始化')
      const bytes = shape.reduce((a, b) => a * b, 1) * 4
      if (!(input instanceof Float32Array) || input.byteLength !== bytes || input.byteOffset !== 0 || input.buffer.byteLength !== bytes) throw new Error('分离频谱数据无效')
      if (busy) throw new Error('已有分离推理正在执行')
      busy = true
      let tensor: Tensor | undefined
      let outputs: Awaited<ReturnType<typeof active.run>> | undefined
      try {
        tensor = new ort.Tensor('float32', input, shape)
        outputs = await active.run({ [active.inputNames[0]]: tensor })
        const data = await outputs[active.outputNames[0]].getData()
        if (!(data instanceof Float32Array) || data.byteLength !== bytes) throw new Error('分离输出格式无效')
        // 避免 IPC 在返回视图时复制超出当前频谱的底层内存。
        return data.byteOffset === 0 && data.buffer.byteLength === bytes ? data : data.slice()
      } finally {
        tensor?.dispose()
        for (const value of Object.values(outputs ?? {})) value.dispose()
        busy = false
      }
    },
  }
}
