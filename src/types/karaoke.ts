import type { Track } from './domain'

/** AI K 歌模型：服务端目录表与渲染层共用的结构。 */

export type KaraokeModelId = 'hq3' | 'hq3-fp16' | 'kara2'

export const DEFAULT_KARAOKE_MODEL: KaraokeModelId = 'hq3'
export const ACCOMPANIMENTS_PLAYLIST_ID = 'system:accompaniments'
export const KARAOKE_MODEL_MEMORY_MB: Record<KaraokeModelId, number> = { hq3: 1640, 'hq3-fp16': 900, kara2: 1100 }

export interface KaraokeProgress {
  phase: 'model' | 'preparing' | 'decoding' | 'separating' | 'saving'
  progress: number
}

export interface KaraokePort {
  supported(): Promise<boolean>
  knownStem(model: KaraokeModelId, key: string): string | null
  forget(model: KaraokeModelId, key: string): void
  separate(model: KaraokeModelId, key: string, src: string, onProgress: (progress: KaraokeProgress) => void, signal: AbortSignal): Promise<string>
  release(): void
}

export interface Accompaniment {
  id: string
  key: string
  model: KaraokeModelId
  track: Track
  directory: string
  fileName: string
  bytes: number
  generatedAt: number
  available: boolean
  /** 保存了人声侧轨，播放时可混回和声与导唱 */
  vocals?: boolean
}

export interface KaraokeLibrary {
  directory: string
  directoryNotice?: string
  items: Accompaniment[]
}

export interface KaraokeResources {
  canStart: boolean
  availableBytes: number
  requiredBytes: number
}

/** MDX-Net 前后处理参数，取自 UVR 模型参数表。 */
export interface KaraokeModelParams {
  nFft: number
  dimF: number
  dimT: number
}

export type KaraokeModelState = 'missing' | 'downloading' | 'ready' | 'error'

export interface KaraokeModelView {
  id: KaraokeModelId
  name: string
  description: string
  precision: 'fp32' | 'fp16'
  /** fp16 模型需要显卡支持 WebGPU shader-f16 */
  requiresF16: boolean
  bytes: number
  /** 分离时 GPU 显存峰值的实测近似值 */
  peakVramMb: number
  params: KaraokeModelParams
  state: KaraokeModelState
  receivedBytes: number
  error?: string
  /** 用该模型分离出的伴奏占用 */
  stemBytes: number
  stemCount: number
}

export interface KaraokeModelsResponse {
  models: KaraokeModelView[]
  stemLimitBytes: number
}

export function isKaraokeModelId(value: unknown): value is KaraokeModelId {
  return value === 'hq3' || value === 'hq3-fp16' || value === 'kara2'
}

/** QQ 补齐 mid 前后仍按同一目录 ID 识别歌曲。 */
export function sameKaraokeTrack(a: Track, b: Track): boolean {
  return a.source === b.source && (String(a.id) === String(b.id)
    || (a.mid != null && b.mid != null && String(a.mid) === String(b.mid)))
}
