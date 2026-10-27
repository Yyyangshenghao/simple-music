import type { KaraokeModelParams } from '../../types/karaoke'

/** 宿主与分离 Worker 之间的消息；一个 Worker 只加载一个模型。 */
export type SeparatorRequest =
  | { type: 'init'; wasm: ArrayBuffer; model: ArrayBuffer; params: KaraokeModelParams }
  | { type: 'init-native'; params: KaraokeModelParams }
  | { type: 'native-result'; id: number; sequence: number; spec?: Float32Array; error?: string }
  | { type: 'separate'; id: number; left: Float32Array; right: Float32Array }
  | { type: 'cancel'; id: number }

export type SeparatorResponse =
  | { type: 'ready' }
  | { type: 'progress'; id: number; done: number; total: number }
  | { type: 'native-infer'; id: number; sequence: number; spec: Float32Array }
  | { type: 'done'; id: number; wav: Blob }
  | { type: 'error'; id: number; message: string }
