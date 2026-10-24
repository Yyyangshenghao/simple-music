export interface ParticleRippleBeat {
  kind: 'accent' | 'soft'
  strength: number
}

/** 粒光鼓点检测：比较低频与自适应背景的突增，不要求每拍都跌回固定音量以下。 */
export function createParticleRippleBeatDetector() {
  let previous = 0
  let background = 0
  let lastSample = -Infinity
  let startedAt = 0
  let lastHit = -Infinity
  let lastSoftHit = -Infinity
  let previousPercussion = 0
  let percussionBackground = 0
  let typicalBassOnset = 0.08
  let bassVelocity = 0
  let tapVelocity = 0
  let lastValueChange = 0

  return {
    /** bassSum 是 subBass + bass（0..2），time 使用场景时钟的秒数。 */
    update(bassSum: number, time: number, sensitivity: number, percussion = 0): ParticleRippleBeat | null {
      const tap = Math.max(0, Math.min(1, percussion))
      const energy = Math.max(0, Math.min(1, bassSum * 0.5))
      if (!Number.isFinite(lastSample) || time < lastSample || time - lastSample > 0.5) {
        previous = background = energy
        lastSample = startedAt = time
        lastHit = lastSoftHit = -Infinity
        previousPercussion = percussionBackground = tap
        typicalBassOnset = 0.08
        bassVelocity = tapVelocity = 0
        lastValueChange = time
        return null
      }
      const delta = time - lastSample
      const level = Math.max(0, Math.min(1, sensitivity))
      const threshold = Math.max(0.045 - 0.035 * level, background * (0.18 - 0.12 * level))
      const bassRise = energy - background
      const tapRise = tap - percussionBackground
      // 宿主频谱约 30Hz；高刷帧重复读到旧值时，不能把下一份数据误算成更陡的冲击。
      const changed = energy !== previous || tap !== previousPercussion
      const sampleDelta = Math.min(0.25, time - lastValueChange)
      const bassSpeed = changed && sampleDelta > 0 ? (energy - previous) / sampleDelta : 0
      const tapSpeed = changed && sampleDelta > 0 ? (tap - previousPercussion) / sampleDelta : 0
      // 突然加速的上升沿才是瞬态；匀速渐强只推动段落能量，不反复伪造鼓点。
      const bassAttack = bassSpeed > Math.max(0.02, bassVelocity * 1.8)
      const tapAttack = tapSpeed > Math.max(0.04, tapVelocity * 1.8)
      const bassOnset = bassAttack && energy > 0.035 && energy - previous > 0.001 && bassRise > threshold * 0.45
      const tapThreshold = Math.max(0.028 - 0.018 * level, percussionBackground * (0.16 - 0.08 * level))
      const tapOnset = tapAttack && tap > 0.025 && tap - previousPercussion > 0.002 && tapRise > tapThreshold
      // 大鼓需显著超过近期普通低频瞬态；提高灵敏度只增加轻节奏，不把它们升级为重浪。
      const accentThreshold = Math.max(0.12, typicalBassOnset * 1.8)
      const hit = time - startedAt >= 0.25 && time - lastHit >= 0.48
        && bassOnset && bassRise > accentThreshold && bassRise > tapRise * 0.8
      const softHit = time - startedAt >= 0.25 && time - lastHit >= 0.1 && time - lastSoftHit >= 0.095
        && (bassOnset || tapOnset)
      // 背景缓慢跟随低频抬升、较快回落；持续贝斯不会锁死下一次鼓点。
      background += (energy - background) * -Math.expm1(-delta / (energy > background ? 0.25 : 0.08))
      percussionBackground += (tap - percussionBackground) * -Math.expm1(-delta / (tap > percussionBackground ? 0.18 : 0.06))
      if (changed || time - lastValueChange > 0.15) {
        const velocityBlend = -Math.expm1(-(changed ? sampleDelta : delta) / 0.1)
        bassVelocity += (bassSpeed - bassVelocity) * velocityBlend
        tapVelocity += (tapSpeed - tapVelocity) * velocityBlend
      }
      if (changed) lastValueChange = time
      previousPercussion = tap
      previous = energy
      lastSample = time
      if ((hit || softHit) && bassOnset) typicalBassOnset += (bassRise - typicalBassOnset) * 0.2
      if (hit) {
        lastHit = time
        return { kind: 'accent', strength: Math.min(0.85, 0.4 + (bassRise - accentThreshold) * 1.4) }
      }
      if (softHit) {
        lastSoftHit = time
        return { kind: 'soft', strength: Math.min(0.22, 0.025 + Math.max(bassRise, tapRise) * 0.5) }
      }
      return null
    },
    reset(): void {
      lastSample = -Infinity
      lastHit = lastSoftHit = -Infinity
    },
  }
}
