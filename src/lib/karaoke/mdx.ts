/**
 * UVR MDX-Net 前后处理：对齐 UVR mdxnet.py 的 torch.stft(center=True, reflect, hann periodic)。
 * 模型输入/输出均为 [1, 4, dimF, dimT]，四个通道依次是左实部、左虚部、右实部、右虚部。
 * 不同模型的 n_fft / dim_f 不同（取自 UVR 模型参数表），hop 固定 1024。
 */
export const SAMPLE_RATE = 44100
export const HOP = 1024

export interface MdxParams {
  /** FFT 长度，须为 2 的幂乘以 1、3、5 或 15（UVR 模型用到 5120 / 6144 / 7680） */
  nFft: number
  /** 送入模型的频点数，高于它的频率在还原时置零 */
  dimF: number
  dimT: number
}

export interface Mdx {
  readonly params: MdxParams
  /** 一块覆盖的样本数 */
  readonly CHUNK: number
  /** 每块两端丢弃的样本数 */
  readonly TRIM: number
  /** 每块去掉两端 TRIM 后真正写回的样本数 */
  readonly GEN: number
  /** 模型输入/输出的元素数（4·dimF·dimT） */
  readonly SIZE: number
  fft(re: Float64Array, im: Float64Array, inverse?: boolean): void
  stftChunk(left: Float32Array, right: Float32Array, offset: number, out: Float32Array, shift?: number): void
  istftChunk(spec: Float32Array, outL: Float32Array, outR: Float32Array): void
}

/**
 * 混合基 FFT：N = radix × 2^k，按 n mod radix 抽取做 radix 次 2^k 点基 2 FFT，再合并；inverse 不含 1/N。
 */
function createFft(n: number): (re: Float64Array, im: Float64Array, inverse?: boolean) => void {
  const radix = [1, 3, 5, 15].find(r => n % r === 0 && Number.isInteger(Math.log2(n / r)))
  if (!radix) throw new Error(`不支持的 FFT 长度 ${n}`)
  const size = n / radix
  const levels = Math.log2(size)
  const bitrev = new Uint32Array(size)
  for (let i = 0; i < size; i++) {
    let r = 0
    for (let b = 0; b < levels; b++) r |= ((i >> b) & 1) << (levels - 1 - b)
    bitrev[i] = r
  }
  const halfRe = new Float64Array(size / 2)
  const halfIm = new Float64Array(size / 2)
  for (let k = 0; k < size / 2; k++) {
    halfRe[k] = Math.cos(-2 * Math.PI * k / size)
    halfIm[k] = Math.sin(-2 * Math.PI * k / size)
  }
  const fullRe = new Float64Array(n)
  const fullIm = new Float64Array(n)
  for (let k = 0; k < n; k++) {
    fullRe[k] = Math.cos(-2 * Math.PI * k / n)
    fullIm[k] = Math.sin(-2 * Math.PI * k / n)
  }

  /** 2^k 点基 2 复数 FFT（原地）。 */
  function fftPow2(re: Float64Array, im: Float64Array): void {
    for (let i = 0; i < size; i++) {
      const j = bitrev[i]
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t
        t = im[i]; im[i] = im[j]; im[j] = t
      }
    }
    for (let span = 2; span <= size; span <<= 1) {
      const half = span >> 1
      const step = size / span
      for (let start = 0; start < size; start += span) {
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

  const sub = Array.from({ length: radix }, () => [new Float64Array(size), new Float64Array(size)] as const)
  return (re, im, inverse = false) => {
    const sign = inverse ? -1 : 1
    for (let r = 0; r < radix; r++) {
      const [sr, si] = sub[r]
      for (let m = 0; m < size; m++) {
        sr[m] = re[radix * m + r]
        si[m] = sign * im[radix * m + r]
      }
      fftPow2(sr, si)
    }
    for (let k = 0; k < n; k++) {
      const m = k & (size - 1)
      let accR = sub[0][0][m], accI = sub[0][1][m]
      for (let r = 1; r < radix; r++) {
        const t = (r * k) % n
        const wr = fullRe[t], wi = fullIm[t], xr = sub[r][0][m], xi = sub[r][1][m]
        accR += xr * wr - xi * wi
        accI += xr * wi + xi * wr
      }
      re[k] = accR
      im[k] = sign * accI
    }
  }
}

const reflect = (i: number, len: number) => i < 0 ? -i : i >= len ? 2 * (len - 1) - i : i

/** 按模型参数生成前后处理；表与缓冲区按参数各建一份。 */
export function createMdx(params: MdxParams): Mdx {
  const { nFft: N_FFT, dimF: DIM_F, dimT: DIM_T } = params
  if (DIM_F > N_FFT / 2) throw new Error('dimF 不能超过 nFft / 2')
  const CHUNK = HOP * (DIM_T - 1)
  const TRIM = N_FFT / 2
  const GEN = CHUNK - 2 * TRIM
  const PLANE = DIM_F * DIM_T
  const fft = createFft(N_FFT)
  const hann = new Float32Array(N_FFT)
  for (let n = 0; n < N_FFT; n++) hann[n] = 0.5 - 0.5 * Math.cos(2 * Math.PI * n / N_FFT)
  const frameRe = new Float64Array(N_FFT)
  const frameIm = new Float64Array(N_FFT)
  const accL = new Float64Array(CHUNK + N_FFT)
  const accR = new Float64Array(CHUNK + N_FFT)
  const envelope = new Float64Array(CHUNK + N_FFT)

  /**
   * 一块（CHUNK 个样本）的 STFT，写入模型输入；左右声道打包成一次复数 FFT（z = l + i·r）
   *
   * @param offset 块在 left/right 中的起点
   * @param out 长度 4·DIM_F·DIM_T
   * @param shift 虚拟补零：按 left/right 前面还有 shift 个零读取，越界部分也按零处理，省去整首补边的拷贝
   */
  function stftChunk(left: Float32Array, right: Float32Array, offset: number, out: Float32Array, shift = 0): void {
    const length = left.length
    for (let t = 0; t < DIM_T; t++) {
      const start = t * HOP - N_FFT / 2
      for (let n = 0; n < N_FFT; n++) {
        const idx = offset + reflect(start + n, CHUNK) - shift
        const inside = idx >= 0 && idx < length
        frameRe[n] = inside ? left[idx] * hann[n] : 0
        frameIm[n] = inside ? right[idx] * hann[n] : 0
      }
      fft(frameRe, frameIm)
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

  /** 模型输出谱还原为时域块：逐帧逆变换、加窗叠加后除以窗平方和；DIM_F 及以上的频点置零。 */
  function istftChunk(spec: Float32Array, outL: Float32Array, outR: Float32Array): void {
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
      fft(frameRe, frameIm, true)
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

  return { params, CHUNK, TRIM, GEN, SIZE: 4 * PLANE, fft, stftChunk, istftChunk }
}

/**
 * 整首分离：逐块 STFT → 推理 → 逆变换，只保留每块中间 GEN 段，交给 write 按位置写出
 *
 * @param mdx 该模型的前后处理
 * @param infer 模型推理，入参与返回都是 [1,4,dimF,dimT] 的谱
 * @param write 某段伴奏（左右声道，长度不超过 GEN）及其在整首中的起点
 * @param onProgress 已完成块数 / 总块数
 * @param cancelled 每块之间检查，返回 true 时中止并抛出 AbortError
 */
export async function separate(
  mdx: Mdx,
  left: Float32Array,
  right: Float32Array,
  infer: (spec: Float32Array) => Promise<Float32Array>,
  write: (position: number, left: Float32Array, right: Float32Array) => void | Promise<void>,
  onProgress: (done: number, total: number) => void = () => {},
  cancelled: () => boolean = () => false,
): Promise<void> {
  const { CHUNK, GEN, TRIM, SIZE, stftChunk, istftChunk } = mdx
  const samples = left.length
  const input = new Float32Array(SIZE)
  const chunkL = new Float32Array(CHUNK)
  const chunkR = new Float32Array(CHUNK)
  const total = Math.ceil((samples + 1) / GEN)
  // 前面虚拟补 TRIM 个零，尾部越界按零读取，与 UVR 先补边再切块一致
  for (let i = 0, done = 0; done < total; i += GEN) {
    if (cancelled()) throw new DOMException('Aborted', 'AbortError')
    stftChunk(left, right, i, input, TRIM)
    istftChunk(await infer(input), chunkL, chunkR)
    const length = Math.min(GEN, samples - i)
    if (length > 0) await write(i, chunkL.subarray(TRIM, TRIM + length), chunkR.subarray(TRIM, TRIM + length))
    onProgress(++done, total)
  }
}

const WAV_HEADER = 44

function wavHeader(view: DataView, samples: number, sampleRate: number): void {
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
  }
  ascii(0, 'RIFF'); view.setUint32(4, 36 + samples * 4, true); ascii(8, 'WAVE'); ascii(12, 'fmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 2, true)
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 4, true)
  view.setUint16(32, 4, true); view.setUint16(34, 16, true); ascii(36, 'data'); view.setUint32(40, samples * 4, true)
}

function writeWavSamples(view: DataView, offset: number, left: Float32Array, right: Float32Array): void {
  for (let i = 0, o = offset; i < left.length; i++, o += 4) {
    view.setInt16(o, Math.round(Math.max(-1, Math.min(1, left[i])) * 32767), true)
    view.setInt16(o + 2, Math.round(Math.max(-1, Math.min(1, right[i])) * 32767), true)
  }
}

/** 16 bit PCM 立体声 WAV。 */
export function encodeWav(left: Float32Array, right: Float32Array, sampleRate = SAMPLE_RATE): ArrayBuffer {
  const buf = new ArrayBuffer(WAV_HEADER + left.length * 4)
  const view = new DataView(buf)
  wavHeader(view, left.length, sampleRate)
  writeWavSamples(view, WAV_HEADER, left, right)
  return buf
}

/** 整首分离并直接写成 16 bit WAV，不再额外保留整首的浮点伴奏。 */
export async function separateToWav(
  mdx: Mdx,
  left: Float32Array,
  right: Float32Array,
  infer: (spec: Float32Array) => Promise<Float32Array>,
  onProgress?: (done: number, total: number) => void,
  cancelled?: () => boolean,
): Promise<ArrayBuffer> {
  const buf = new ArrayBuffer(WAV_HEADER + left.length * 4)
  const view = new DataView(buf)
  wavHeader(view, left.length, SAMPLE_RATE)
  await separate(mdx, left, right, infer, (position, l, r) => writeWavSamples(view, WAV_HEADER + position * 4, l, r), onProgress, cancelled)
  return buf
}

/** 按块写出 WAV；等待上一块落盘后才继续推理，内存中不保留整首 WAV。 */
export async function separateToWavStream(
  mdx: Mdx,
  left: Float32Array,
  right: Float32Array,
  infer: (spec: Float32Array) => Promise<Float32Array>,
  write: (chunk: Uint8Array<ArrayBuffer>) => Promise<void>,
  onProgress?: (done: number, total: number) => void,
  cancelled?: () => boolean,
): Promise<void> {
  const header = new Uint8Array(WAV_HEADER)
  wavHeader(new DataView(header.buffer), left.length, SAMPLE_RATE)
  await write(header)
  await separate(mdx, left, right, infer, async (_position, l, r) => {
    const chunk = new Uint8Array(l.length * 4)
    writeWavSamples(new DataView(chunk.buffer), 0, l, r)
    await write(chunk)
  }, onProgress, cancelled)
}
