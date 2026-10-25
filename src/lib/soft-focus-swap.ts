/**
 * 换场景的柔焦过渡：旧场景虚化退下（out）→ 换上新场景并等它画出首帧（wait，有上限）
 * → 新场景从同样的虚化里落定（in）。全屏 WebGL 同屏只跑一个场景，所以不叠两份，
 * 而是在同一块画布上先虚化再换。
 */
export const SOFT_FOCUS_OUT_MS = 220
export const SOFT_FOCUS_READY_LIMIT_MS = 600
export const SOFT_FOCUS_IN_MS = 420

export type SoftFocusPhase = 'idle' | 'out' | 'wait' | 'in'

export interface SoftFocusState<T> {
  shown: T
  pending: T | null
  phase: SoftFocusPhase
}

export type SoftFocusEvent<T> =
  | { type: 'change'; target: T; instant: boolean }
  | { type: 'outDone' }
  | { type: 'ready' }
  | { type: 'inDone' }

export function softFocusReducer<T>(state: SoftFocusState<T>, event: SoftFocusEvent<T>): SoftFocusState<T> {
  switch (event.type) {
    case 'change':
      if (event.instant) {
        return state.shown === event.target && state.phase === 'idle' && state.pending === null
          ? state
          : { shown: event.target, pending: null, phase: 'idle' }
      }
      if (event.target === state.shown) {
        // 退场途中又切回当前场景：不必换，直接落定。
        return state.phase === 'out' ? { ...state, pending: null, phase: 'in' } : state
      }
      if (event.target === state.pending) return state
      return { ...state, pending: event.target, phase: 'out' }
    case 'outDone':
      return state.phase === 'out' && state.pending !== null
        ? { shown: state.pending, pending: null, phase: 'wait' }
        : state
    case 'ready':
      return state.phase === 'wait' ? { ...state, phase: 'in' } : state
    case 'inDone':
      return state.phase === 'in' ? { ...state, phase: 'idle' } : state
  }
}
