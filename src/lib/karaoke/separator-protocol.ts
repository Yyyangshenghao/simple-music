/** 宿主与分离 Worker 之间的消息。 */
export type SeparatorRequest =
  | { type: 'init'; wasm: ArrayBuffer; model: ArrayBuffer }
  | { type: 'separate'; id: number; left: Float32Array; right: Float32Array }
  | { type: 'cancel'; id: number }

export type SeparatorResponse =
  | { type: 'ready' }
  | { type: 'progress'; id: number; done: number; total: number }
  | { type: 'done'; id: number; wav: ArrayBuffer }
  | { type: 'error'; id: number; message: string }
