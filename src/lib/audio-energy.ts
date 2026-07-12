/** 从频谱数据取低频段平均能量（0–1）。取前 16 个 bin。 */
export function bassEnergyFrom(data: Uint8Array | number[]): number {
  if (!data.length) return 0
  const n = Math.min(16, data.length)
  let sum = 0
  for (let i = 0; i < n; i++) sum += data[i]
  return sum / n / 255
}

/** 取指定频段原始值数组（归一化到 0–1），用于波形类效果。 */
export function spectrumSlice(data: Uint8Array | number[], start: number, count: number): Float32Array {
  const result = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    const idx = start + i
    result[i] = idx < data.length ? data[idx] / 255 : 0
  }
  return result
}

/** 指数平滑：上升快（有节拍感）、下降慢（不抖动）。 */
export function smoothEnergy(prev: number, next: number): number {
  const k = next > prev ? 0.35 : 0.08
  return prev + (next - prev) * k
}

/** 七段频谱能量（0–1），供逐粒子径向音频响应使用。 */
export interface BandEnergies {
  subBass: number
  bass: number
  lowMid: number
  mid: number
  highMid: number
  presence: number
  air: number
  energy: number
}

/** 各频段的 bin 范围（假设 fftSize=2048 → 1024 bin，采样率 44100Hz 时近似覆盖 20Hz~20kHz）。 */
const BAND_RANGES: Record<Exclude<keyof BandEnergies, 'energy'>, [number, number]> = {
  subBass: [0, 3],
  bass: [3, 12],
  lowMid: [12, 23],
  mid: [23, 93],
  highMid: [93, 186],
  presence: [186, 279],
  air: [279, 1024]
}

function averageRange(data: Uint8Array | number[], start: number, end: number): number {
  const len = data.length
  const from = Math.min(start, len)
  const to = Math.min(end, len)
  if (to <= from) return 0
  let sum = 0
  for (let i = from; i < to; i++) sum += data[i]
  return sum / (to - from) / 255
}

/** 把频谱数据切成 7 段能量 + 整体能量，供 CoverParticleCloud 的逐粒子径向弹跳使用。 */
export function bandEnergiesFrom(data: Uint8Array | number[]): BandEnergies {
  return {
    subBass: averageRange(data, ...BAND_RANGES.subBass),
    bass: averageRange(data, ...BAND_RANGES.bass),
    lowMid: averageRange(data, ...BAND_RANGES.lowMid),
    mid: averageRange(data, ...BAND_RANGES.mid),
    highMid: averageRange(data, ...BAND_RANGES.highMid),
    presence: averageRange(data, ...BAND_RANGES.presence),
    air: averageRange(data, ...BAND_RANGES.air),
    energy: averageRange(data, 0, Math.min(data.length, 1024))
  }
}
