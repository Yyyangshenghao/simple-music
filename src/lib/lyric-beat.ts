/**
 * 动态歌词样式共用的节拍信号：从播放器频谱的低频能量做起音检测。
 * 不需要离线分析或模型，随播随算；精度不及专门的节拍检测，只用来驱动「随拍」类的轻量效果。
 */
export interface BeatSignal {
  /** 低频能量 0..1 */
  energy: number
  /** 最近一次起音后的衰减脉冲 0..1，样式直接拿来乘到位移、缩放或亮度上 */
  pulse: number
  /** 这一帧是否检测到新的起音 */
  onset: boolean
}

export interface OnsetDetectorOptions {
  /** 参与计算的低频 bin 数 */
  bins?: number
  /** 超过均值多少个标准差算起音 */
  threshold?: number
  /** 两次起音的最短间隔（毫秒），避免一拍内重复触发 */
  refractoryMs?: number
  /** 脉冲衰减的时间常数（毫秒） */
  decayMs?: number
}

export function createOnsetDetector(options: OnsetDetectorOptions = {}) {
  const bins = options.bins ?? 12
  const threshold = options.threshold ?? 1.4
  const refractoryMs = options.refractoryMs ?? 180
  const decayMs = options.decayMs ?? 220
  let mean = 0
  let variance = 0
  let primed = false
  let lastOnset = -Infinity
  return {
    update(spectrum: ArrayLike<number>, now: number): BeatSignal {
      const count = Math.min(bins, spectrum.length)
      let sum = 0
      for (let i = 0; i < count; i++) sum += spectrum[i]
      const energy = count ? sum / count / 255 : 0
      if (!primed) {
        mean = energy
        primed = count > 0
      }
      const deviation = energy - mean
      const std = Math.sqrt(variance)
      const onset = primed && energy > 0.08 && deviation > Math.max(0.03, threshold * std) && now - lastOnset >= refractoryMs
      if (onset) lastOnset = now
      // 指数滑动平均：均值慢跟随，方差同步更新，安静段与响段都能自适应。
      mean += deviation * 0.06
      variance = Math.max(0, variance + (deviation * deviation - variance) * 0.06)
      const pulse = Number.isFinite(lastOnset) ? Math.exp(-(now - lastOnset) / decayMs) : 0
      return { energy, pulse, onset }
    },
    reset(): void {
      mean = 0
      variance = 0
      primed = false
      lastOnset = -Infinity
    },
  }
}
