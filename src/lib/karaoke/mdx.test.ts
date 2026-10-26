import { describe, expect, it } from 'vitest'
import { CHUNK, DIM_F, DIM_T, GEN, N_FFT, encodeWav, fft6144, istftChunk, separate, stftChunk } from './mdx'

const signal = (n: number, seed: number) => Float32Array.from({ length: n }, (_, i) => Math.sin(i * 0.013 * seed) * 0.4 + Math.sin(i * 0.31 + seed) * 0.1)

describe('MDX 前后处理', () => {
  it('6144 点混合基 FFT 与直接 DFT 一致', () => {
    const re = Float64Array.from({ length: N_FFT }, (_, i) => Math.sin(i * 0.07) + (i % 7) / 10)
    const im = Float64Array.from({ length: N_FFT }, (_, i) => Math.cos(i * 0.03))
    const [r0, i0] = [re.slice(), im.slice()]
    fft6144(re, im)
    for (const k of [0, 1, 37, 2048, 3071, 6143]) {
      let sr = 0, si = 0
      for (let n = 0; n < N_FFT; n++) {
        const a = -2 * Math.PI * k * n / N_FFT
        sr += r0[n] * Math.cos(a) - i0[n] * Math.sin(a)
        si += r0[n] * Math.sin(a) + i0[n] * Math.cos(a)
      }
      expect(re[k]).toBeCloseTo(sr, 6)
      expect(im[k]).toBeCloseTo(si, 6)
    }
    fft6144(re, im, true)
    expect(re[123] / N_FFT).toBeCloseTo(r0[123], 9)
  })

  it('STFT 后直接逆变换还原块内信号', () => {
    const left = signal(CHUNK, 1), right = signal(CHUNK, 2)
    const spec = new Float32Array(4 * DIM_F * DIM_T)
    stftChunk(left, right, 0, spec)
    const outL = new Float32Array(CHUNK), outR = new Float32Array(CHUNK)
    istftChunk(spec, outL, outR)
    let err = 0
    for (let i = N_FFT; i < CHUNK - N_FFT; i++) err = Math.max(err, Math.abs(outL[i] - left[i]), Math.abs(outR[i] - right[i]))
    expect(err).toBeLessThan(1e-4)
  })

  it('整首分块拼接：模型为恒等时输出等于输入，进度逐块上报', async () => {
    const length = GEN * 2 + 1234
    const left = signal(length, 3), right = signal(length, 4)
    const progress: number[] = []
    const [l, r] = await separate(left, right, async spec => spec.slice(), done => progress.push(done))
    expect(l.length).toBe(length)
    expect(progress).toEqual([1, 2, 3])
    let err = 0
    for (let i = 0; i < length; i++) err = Math.max(err, Math.abs(l[i] - left[i]), Math.abs(r[i] - right[i]))
    expect(err).toBeLessThan(1e-4)
    await expect(separate(left, right, async spec => spec, undefined, () => true)).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('WAV 头与样本编码', () => {
    const view = new DataView(encodeWav(new Float32Array([1, -1]), new Float32Array([0, 0.5])))
    expect(String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3))).toBe('RIFF')
    expect(view.getUint32(24, true)).toBe(44100)
    expect([view.getInt16(44, true), view.getInt16(46, true), view.getInt16(48, true)]).toEqual([32767, 0, -32767])
  })
})
