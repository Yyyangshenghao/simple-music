/** 把近期节奏密度与编曲能量变化合成段落推进感，不假定歌曲的副歌位置。 */
export function createParticleMusicDrive() {
  let lastTime = -Infinity
  let startedAt = 0
  let fastEnergy = 0
  let contextEnergy = 0
  let density = 0
  let drive = 0
  let quietSeconds = 0

  return {
    update(energy: number, time: number, onset: boolean): number {
      const level = Math.max(0, Math.min(1, energy))
      if (!Number.isFinite(lastTime) || time < lastTime || time - lastTime > 0.5) {
        lastTime = startedAt = time
        fastEnergy = contextEnergy = level
        density = drive = 0
        quietSeconds = level <= 0.005 ? 0.5 : 0
        return drive
      }
      const delta = time - lastTime
      lastTime = time
      if (level <= 0.005) quietSeconds += delta
      else {
        if (quietSeconds >= 0.5) {
          // 面板先打开但未播放、或暂停后恢复，同样需要重新建立频谱基准。
          startedAt = time
          fastEnergy = contextEnergy = level
          density = 0
        }
        quietSeconds = 0
      }
      fastEnergy += (level - fastEnergy) * -Math.expm1(-delta / 0.25)
      // 起播先建立频谱基准，避免 analyser 从空到有的过程占满段落动态范围。
      if (time - startedAt < 1.5) contextEnergy = fastEnergy
      else contextEnergy += (level - contextEnergy) * -Math.expm1(-delta / 8)
      density = density * Math.exp(-delta * 1.5) + (onset ? 1 : 0)
      const rhythm = Math.max(0, Math.min(1, (density - 0.4) / 1.8))
      const lift = Math.max(0, Math.min(1, (fastEnergy - contextEnergy) / Math.max(0.1, contextEnergy)))
      const target = Math.min(1, rhythm * 0.85 + lift * 0.65)
      drive += (target - drive) * -Math.expm1(-delta / (target > drive ? 0.65 : 1.8))
      return drive
    },
  }
}
