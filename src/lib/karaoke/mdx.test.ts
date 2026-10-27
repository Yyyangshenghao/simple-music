import { describe, expect, it, vi } from 'vitest'
import { createMdx, encodeWav, separateToWav, separateToWavStream } from './mdx'

const signal = (n: number, seed: number) => Float32Array.from({ length: n }, (_, i) => Math.sin(i * 0.013 * seed) * 0.4 + Math.sin(i * 0.31 + seed) * 0.1)
const HQ3 = createMdx({ nFft: 6144, dimF: 3072, dimT: 256 })

describe('MDX 前后处理', () => {
  it.each([6144, 5120, 7680, 4096])('%i 点混合基 FFT 与直接 DFT 一致', (n) => {
    const { fft } = createMdx({ nFft: n, dimF: 1024, dimT: 4 })
    const re = Float64Array.from({ length: n }, (_, i) => Math.sin(i * 0.07) + (i % 7) / 10)
    const im = Float64Array.from({ length: n }, (_, i) => Math.cos(i * 0.03))
    const [r0, i0] = [re.slice(), im.slice()]
    fft(re, im)
    for (const k of [0, 1, 37, n / 3 | 0, n / 2 - 1, n - 1]) {
      let sr = 0, si = 0
      for (let j = 0; j < n; j++) {
        const a = -2 * Math.PI * k * j / n
        sr += r0[j] * Math.cos(a) - i0[j] * Math.sin(a)
        si += r0[j] * Math.sin(a) + i0[j] * Math.cos(a)
      }
      expect(re[k]).toBeCloseTo(sr, 6)
      expect(im[k]).toBeCloseTo(si, 6)
    }
    fft(re, im, true)
    expect(re[123] / n).toBeCloseTo(r0[123], 9)
  })

  it('不支持的 FFT 长度与超出 nFft/2 的 dimF 直接报错', () => {
    expect(() => createMdx({ nFft: 6000, dimF: 1024, dimT: 4 })).toThrow('不支持')
    expect(() => createMdx({ nFft: 4096, dimF: 3000, dimT: 4 })).toThrow('dimF')
  })

  it.each([[6144, 3072], [5120, 2048]])('n_fft %i / dim_f %i：STFT 后直接逆变换还原块内低频信号', (nFft, dimF) => {
    const mdx = createMdx({ nFft, dimF, dimT: 256 })
    // dim_f 以上的频率会被置零，测试信号只含低频
    const left = Float32Array.from({ length: mdx.CHUNK }, (_, i) => Math.sin(i * 0.013) * 0.4 + Math.sin(i * 0.2) * 0.1)
    const right = Float32Array.from({ length: mdx.CHUNK }, (_, i) => Math.sin(i * 0.026 + 1) * 0.4)
    const spec = new Float32Array(mdx.SIZE)
    mdx.stftChunk(left, right, 0, spec)
    const outL = new Float32Array(mdx.CHUNK), outR = new Float32Array(mdx.CHUNK)
    mdx.istftChunk(spec, outL, outR)
    let err = 0
    for (let i = nFft; i < mdx.CHUNK - nFft; i++) err = Math.max(err, Math.abs(outL[i] - left[i]), Math.abs(outR[i] - right[i]))
    expect(err).toBeLessThan(1e-4)
  })

  it('虚拟补零读取与先补边再切块完全一致', () => {
    const { GEN, TRIM, SIZE, stftChunk } = HQ3
    const length = GEN + 777
    const left = signal(length, 5), right = signal(length, 6)
    const padded = (x: Float32Array) => { const p = new Float32Array(TRIM + length + GEN + TRIM); p.set(x, TRIM); return p }
    const [pl, pr] = [padded(left), padded(right)]
    const a = new Float32Array(SIZE), b = new Float32Array(SIZE)
    for (const offset of [0, GEN]) {
      stftChunk(pl, pr, offset, a)
      stftChunk(left, right, offset, b, TRIM)
      expect(b).toEqual(a)
    }
  })

  it('整首分块拼接直接写成 WAV：模型为恒等时输出等于输入，进度逐块上报', async () => {
    const length = HQ3.GEN * 2 + 1234
    const left = signal(length, 3), right = signal(length, 4)
    const progress: number[] = []
    const view = new DataView(await separateToWav(HQ3, left, right, async spec => spec.slice(), done => progress.push(done)))
    expect(view.byteLength).toBe(44 + length * 4)
    expect(view.getUint32(40, true)).toBe(length * 4)
    expect(progress).toEqual([1, 2, 3])
    let err = 0
    for (let i = 0; i < length; i++) {
      err = Math.max(err, Math.abs(view.getInt16(44 + i * 4, true) / 32767 - left[i]), Math.abs(view.getInt16(46 + i * 4, true) / 32767 - right[i]))
    }
    expect(err).toBeLessThan(1e-4)
    await expect(separateToWav(HQ3, left, right, async spec => spec, undefined, () => true)).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('长度恰为整块时多补一块，与 UVR 补边规则一致', async () => {
    const progress: number[] = []
    await separateToWav(HQ3, signal(HQ3.GEN, 1), signal(HQ3.GEN, 2), async spec => spec, done => progress.push(done))
    expect(progress).toEqual([1, 2])
  })

  it('WAV 头与样本编码', () => {
    const view = new DataView(encodeWav(new Float32Array([1, -1]), new Float32Array([0, 0.5])))
    expect(String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3))).toBe('RIFF')
    expect(view.getUint32(24, true)).toBe(44100)
    expect([view.getInt16(44, true), view.getInt16(46, true), view.getInt16(48, true)]).toEqual([32767, 0, -32767])
  })

  it.each([0, 3072, 7123])('分块 WAV 与完整编码逐字节一致（%i 个样本）', async (length) => {
    const mdx = createMdx({ nFft: 4096, dimF: 2048, dimT: 8 })
    const left = signal(length, 3), right = signal(length, 4)
    const chunks: Uint8Array[] = []
    const infer = async (spec: Float32Array) => spec.slice()
    await separateToWavStream(mdx, left, right, infer, async chunk => { chunks.push(chunk) })
    const actual = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.byteLength, 0))
    let offset = 0
    for (const chunk of chunks) { actual.set(chunk, offset); offset += chunk.byteLength }
    expect(actual).toEqual(new Uint8Array(await separateToWav(mdx, left, right, infer)))
    expect(chunks.every(chunk => chunk.byteLength <= Math.max(44, mdx.GEN * 4))).toBe(true)
  })

  it('人声侧轨等于原曲减伴奏，与伴奏逐样本对齐', async () => {
    const mdx = createMdx({ nFft: 4096, dimF: 2048, dimT: 8 })
    const left = signal(7123, 5), right = signal(7123, 6)
    const join = (chunks: Uint8Array[]) => {
      const out = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.byteLength, 0))
      let offset = 0
      for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength }
      return new DataView(out.buffer)
    }
    const accompaniment: Uint8Array[] = [], vocals: Uint8Array[] = []
    // 模型输出全零：伴奏静音，人声侧轨应完整还原原曲
    await separateToWavStream(mdx, left, right, async spec => new Float32Array(spec.length),
      async chunk => { accompaniment.push(chunk) }, undefined, undefined, async chunk => { vocals.push(chunk) })
    const acc = join(accompaniment), voc = join(vocals)
    expect(voc.byteLength).toBe(acc.byteLength)
    expect(voc.getUint32(40, true)).toBe(7123 * 4)
    for (const i of [0, 1, 2047, 3000, 7122]) {
      expect(acc.getInt16(44 + i * 4, true)).toBe(0)
      expect(voc.getInt16(44 + i * 4, true)).toBe(Math.round(left[i] * 32767))
      expect(voc.getInt16(46 + i * 4, true)).toBe(Math.round(right[i] * 32767))
    }
  })

  it('等待当前块写入后才继续推理，写入失败后立即结束', async () => {
    const mdx = createMdx({ nFft: 4096, dimF: 2048, dimT: 8 })
    const infer = vi.fn(async (spec: Float32Array) => spec.slice())
    let rejectWrite!: (error: Error) => void
    const blocked = new Promise<void>((_resolve, reject) => { rejectWrite = reject })
    const write = vi.fn(async (chunk: Uint8Array) => { if (chunk.byteLength !== 44) await blocked })
    const job = separateToWavStream(mdx, signal(7123, 1), signal(7123, 2), infer, write)
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(2))
    expect(infer).toHaveBeenCalledTimes(1)
    const failed = expect(job).rejects.toThrow('磁盘空间不足')
    rejectWrite(new Error('磁盘空间不足'))
    await failed
    expect(infer).toHaveBeenCalledTimes(1)
  })
})
