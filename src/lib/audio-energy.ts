/** 从频谱数据取低频段平均能量（0–1）。取前 16 个 bin，与 CoverParticleCloud 取法一致。 */
export function bassEnergyFrom(data: Uint8Array | number[]): number {
  if (!data.length) return 0
  const n = Math.min(16, data.length)
  let sum = 0
  for (let i = 0; i < n; i++) sum += data[i]
  return sum / n / 255
}

/** 从频谱数据取中频段平均能量（0–1），取 bin 32–96。 */
export function midEnergyFrom(data: Uint8Array | number[]): number {
  if (data.length < 33) return 0
  const start = 32
  const end = Math.min(96, data.length)
  let sum = 0
  for (let i = start; i < end; i++) sum += data[i]
  return sum / (end - start) / 255
}

/** 从频谱数据取高频段平均能量（0–1），取 bin 96 之后。 */
export function highEnergyFrom(data: Uint8Array | number[]): number {
  if (data.length < 97) return 0
  const start = 96
  const end = data.length
  let sum = 0
  for (let i = start; i < end; i++) sum += data[i]
  return sum / (end - start) / 255
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
