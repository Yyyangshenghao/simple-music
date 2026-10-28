import { freemem, totalmem } from 'node:os'
import { KARAOKE_MODEL_MEMORY_MB, type KaraokeModelId, type KaraokeResources } from '../../src/types/karaoke'

const MB = 1024 * 1024
export interface SystemMemory { total: number; free: number }
export const systemMemory = (): SystemMemory => ({ total: totalmem(), free: freemem() })

/** 显存按统一内存设备估算，并为音频解码、辅助进程和其他应用留出余量。 */
export function karaokeResources(model: KaraokeModelId, duration = 0, memory = systemMemory()): KaraokeResources {
  const audioBytes = Math.max(0, duration) / 1000 * 44100 * 16
  // 大内存设备也只预留 1–2 GiB，避免总量比例把正常可用的内存长期挡在准入之外。
  const reserveBytes = Math.max(1024 * MB, Math.min(2048 * MB, memory.total * 0.12))
  const requiredBytes = KARAOKE_MODEL_MEMORY_MB[model] * MB + audioBytes + 512 * MB + reserveBytes
  return { canStart: memory.free >= requiredBytes, availableBytes: memory.free, requiredBytes }
}
