/** 从频谱数据取低频段平均能量（0–1）。取前 16 个 bin，与 CoverParticleCloud 取法一致。 */
export function bassEnergyFrom(data: Uint8Array | number[]): number {
  if (!data.length) return 0
  const n = Math.min(16, data.length)
  let sum = 0
  for (let i = 0; i < n; i++) sum += data[i]
  return sum / n / 255
}

/** 指数平滑：上升快（有节拍感）、下降慢（不抖动）。 */
export function smoothEnergy(prev: number, next: number): number {
  const k = next > prev ? 0.35 : 0.08
  return prev + (next - prev) * k
}
