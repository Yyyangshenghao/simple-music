/**
 * UVR MDX-Net（Inst HQ 3）前后处理：对齐 UVR mdxnet.py 的 torch.stft(center=True, reflect, hann periodic)。
 * 模型输入/输出均为 [1, 4, DIM_F, DIM_T]，四个通道依次是左实部、左虚部、右实部、右虚部。
 */
export const SAMPLE_RATE = 44100
export const N_FFT = 6144
export const HOP = 1024
export const DIM_F = 3072
export const DIM_T = 256
export const CHUNK = HOP * (DIM_T - 1)
export const TRIM = N_FFT / 2
/** 每块去掉两端 TRIM 后真正写回的样本数。 */
export const GEN = CHUNK - 2 * TRIM
const HALF = N_FFT / 3
const PLANE = DIM_F * DIM_T

const hann = new Float32Array(N_FFT)
for (let n = 0; n < N_FFT; n++) hann[n] = 0.5 - 0.5 * Math.cos(2 * Math.PI * n / N_FFT)

const bitrev = new Uint16Array(HALF)
const levels = Math.log2(HALF)
for (let i = 0; i < HALF; i++) {
  let r = 0
  for (let b = 0; b < levels; b++) r |= ((i >> b) & 1) << (levels - 1 - b)
  bitrev[i] = r
}
const halfRe = new Float64Array(HALF / 2)
const halfIm = new Float64Array(HALF / 2)
for (let k = 0; k < HALF / 2; k++) {
  halfRe[k] = Math.cos(-2 * Math.PI * k / HALF)
  halfIm[k] = Math.sin(-2 * Math.PI * k / HALF)
}
const fullRe = new Float64Array(N_FFT)
const fullIm = new Float64Array(N_FFT)
for (let k = 0; k < N_FFT; k++) {
  fullRe[k] = Math.cos(-2 * Math.PI * k / N_FFT)
  fullIm[k] = Math.sin(-2 * Math.PI * k / N_FFT)
}

/** 2048 点基 2 复数 FFT（原地）。 */
function fftHalf(re: Float64Array, im: Float64Array): void {
  for (let i = 0; i < HALF; i++) {
    const j = bitrev[i]
    if (j > i) {
      let t = re[i]; re[i] = re[j]; re[j] = t
      t = im[i]; im[i] = im[j]; im[j] = t
    }
  }
  for (let size = 2; size <= HALF; size <<= 1) {
    const half = size >> 1
    const step = HALF / size
    for (let start = 0; start < HALF; start += size) {
      for (let k = 0; k < half; k++) {
        const wr = halfRe[k * step], wi = halfIm[k * step]
        const a = start + k, b = a + half
        const xr = re[b] * wr - im[b] * wi
        const xi = re[b] * wi + im[b] * wr
        re[b] = re[a] - xr; im[b] = im[a] - xi
        re[a] += xr; im[a] += xi
      }
    }
  }
}

const sub = [0, 1, 2].map(() => [new Float64Array(HALF), new Float64Array(HALF)] as const)

/** 6144 = 3 × 2048：按 n mod 3 抽取做三次 2048 点 FFT，再基 3 合并；inverse 不含 1/N。 */
export function fft6144(re: Float64Array, im: Float64Array, inverse = false): void {
  const sign = inverse ? -1 : 1
  for (let r = 0; r < 3; r++) {
    const [sr, si] = sub[r]
    for (let m = 0; m < HALF; m++) {
      sr[m] = re[3 * m + r]
      si[m] = sign * im[3 * m + r]
    }
    fftHalf(sr, si)
  }
  for (let k = 0; k < N_FFT; k++) {
    const m = k & (HALF - 1)
    let accR = sub[0][0][m], accI = sub[0][1][m]
    for (let r = 1; r < 3; r++) {
      const t = (r * k) % N_FFT
      const wr = fullRe[t], wi = fullIm[t], xr = sub[r][0][m], xi = sub[r][1][m]
      accR += xr * wr - xi * wi
      accI += xr * wi + xi * wr
    }
    re[k] = accR
    im[k] = sign * accI
  }
}

const frameRe = new Float64Array(N_FFT)
const frameIm = new Float64Array(N_FFT)
const reflect = (i: number, len: number) => i < 0 ? -i : i >= len ? 2 * (len - 1) - i : i

/**
 * 一块（CHUNK 个样本）的 STFT，写入模型输入；左右声道打包成一次复数 FFT（z = l + i·r）
 *
 * @param offset 块在 left/right 中的起点
 * @param out 长度 4·DIM_F·DIM_T
 */
export function stftChunk(left: Float32Array, right: Float32Array, offset: number, out: Float32Array): void {
  for (let t = 0; t < DIM_T; t++) {
    const start = t * HOP - N_FFT / 2
    for (let n = 0; n < N_FFT; n++) {
      const idx = offset + reflect(start + n, CHUNK)
      frameRe[n] = left[idx] * hann[n]
      frameIm[n] = right[idx] * hann[n]
    }
    fft6144(frameRe, frameIm)
    for (let f = 0; f < DIM_F; f++) {
      const g = f === 0 ? 0 : N_FFT - f
      const zr = frameRe[f], zi = frameIm[f], cr = frameRe[g], ci = -frameIm[g]
      const o = f * DIM_T + t
      // L = (Z[k] + conj Z[N-k]) / 2，R = (Z[k] - conj Z[N-k]) / 2i
      out[o] = (zr + cr) / 2
      out[PLANE + o] = (zi + ci) / 2
      out[2 * PLANE + o] = (zi - ci) / 2
      out[3 * PLANE + o] = -(zr - cr) / 2
    }
  }
}

const accL = new Float64Array(CHUNK + N_FFT)
const accR = new Float64Array(CHUNK + N_FFT)
const envelope = new Float64Array(CHUNK + N_FFT)

/** 模型输出谱还原为时域块：逐帧逆变换、加窗叠加后除以窗平方和；高于 DIM_F 的 Nyquist 置零。 */
export function istftChunk(spec: Float32Array, outL: Float32Array, outR: Float32Array): void {
  accL.fill(0); accR.fill(0); envelope.fill(0)
  for (let t = 0; t < DIM_T; t++) {
    frameRe.fill(0); frameIm.fill(0)
    for (let f = 0; f < DIM_F; f++) {
      const o = f * DIM_T + t
      const lr = spec[o], li = spec[PLANE + o], rr = spec[2 * PLANE + o], ri = spec[3 * PLANE + o]
      if (f === 0) {
        // 直流分量必为实数，丢弃模型输出的虚部（同 irfft），避免左右串扰
        frameRe[0] = lr
        frameIm[0] = rr
        continue
      }
      // Z = L + i·R，负频率处取共轭对称
      frameRe[f] = lr - ri
      frameIm[f] = li + rr
      frameRe[N_FFT - f] = lr + ri
      frameIm[N_FFT - f] = rr - li
    }
    fft6144(frameRe, frameIm, true)
    const base = t * HOP
    for (let n = 0; n < N_FFT; n++) {
      const w = hann[n]
      accL[base + n] += frameRe[n] / N_FFT * w
      accR[base + n] += frameIm[n] / N_FFT * w
      envelope[base + n] += w * w
    }
  }
  for (let i = 0; i < CHUNK; i++) {
    const p = i + N_FFT / 2
    const d = envelope[p] > 1e-11 ? envelope[p] : 1
    outL[i] = accL[p] / d
    outR[i] = accR[p] / d
  }
}

/**
 * 整首分离：逐块 STFT → 推理 → 逆变换，只保留每块中间 GEN 段拼接
 *
 * @param infer 模型推理，入参与返回都是 [1,4,DIM_F,DIM_T] 的谱
 * @param onProgress 已完成块数 / 总块数
 * @param cancelled 每块之间检查，返回 true 时中止并抛出 AbortError
 * @returns 与输入等长的伴奏左右声道
 */
export async function separate(
  left: Float32Array,
  right: Float32Array,
  infer: (spec: Float32Array) => Promise<Float32Array>,
  onProgress: (done: number, total: number) => void = () => {},
  cancelled: () => boolean = () => false,
): Promise<[Float32Array, Float32Array]> {
  const samples = left.length
  const pad = GEN - (samples % GEN)
  const padded = TRIM + samples + pad + TRIM
  const pl = new Float32Array(padded)
  const pr = new Float32Array(padded)
  pl.set(left, TRIM)
  pr.set(right, TRIM)
  const outL = new Float32Array(samples + pad)
  const outR = new Float32Array(samples + pad)
  const input = new Float32Array(4 * PLANE)
  const chunkL = new Float32Array(CHUNK)
  const chunkR = new Float32Array(CHUNK)
  const total = (samples + pad) / GEN
  for (let i = 0, done = 0; i < samples + pad; i += GEN) {
    if (cancelled()) throw new DOMException('Aborted', 'AbortError')
    stftChunk(pl, pr, i, input)
    istftChunk(await infer(input), chunkL, chunkR)
    outL.set(chunkL.subarray(TRIM, TRIM + GEN), i)
    outR.set(chunkR.subarray(TRIM, TRIM + GEN), i)
    onProgress(++done, total)
  }
  return [outL.subarray(0, samples), outR.subarray(0, samples)]
}

/** 16 bit PCM 立体声 WAV。 */
export function encodeWav(left: Float32Array, right: Float32Array, sampleRate = SAMPLE_RATE): ArrayBuffer {
  const n = left.length
  const buf = new ArrayBuffer(44 + n * 4)
  const view = new DataView(buf)
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
  }
  ascii(0, 'RIFF'); view.setUint32(4, 36 + n * 4, true); ascii(8, 'WAVE'); ascii(12, 'fmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 2, true)
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 4, true)
  view.setUint16(32, 4, true); view.setUint16(34, 16, true); ascii(36, 'data'); view.setUint32(40, n * 4, true)
  for (let i = 0, o = 44; i < n; i++, o += 4) {
    view.setInt16(o, Math.round(Math.max(-1, Math.min(1, left[i])) * 32767), true)
    view.setInt16(o + 2, Math.round(Math.max(-1, Math.min(1, right[i])) * 32767), true)
  }
  return buf
}
