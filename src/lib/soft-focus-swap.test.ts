import { describe, expect, it } from 'vitest'
import { softFocusReducer, type SoftFocusState } from './soft-focus-swap'

const idle: SoftFocusState<string> = { shown: 'a', pending: null, phase: 'idle' }

describe('softFocusReducer', () => {
  it('完整过渡：退场 → 换上并等首帧 → 落定', () => {
    let s = softFocusReducer(idle, { type: 'change', target: 'b', instant: false })
    expect(s).toEqual({ shown: 'a', pending: 'b', phase: 'out' })
    s = softFocusReducer(s, { type: 'outDone' })
    expect(s).toEqual({ shown: 'b', pending: null, phase: 'wait' })
    s = softFocusReducer(s, { type: 'ready' })
    expect(s.phase).toBe('in')
    s = softFocusReducer(s, { type: 'inDone' })
    expect(s).toEqual({ shown: 'b', pending: null, phase: 'idle' })
  })

  it('减少动效时直接换，不进入过渡', () => {
    expect(softFocusReducer(idle, { type: 'change', target: 'b', instant: true })).toEqual({ shown: 'b', pending: null, phase: 'idle' })
  })

  it('退场途中切回当前场景则直接落定；切到第三个则改换目标', () => {
    const out = softFocusReducer(idle, { type: 'change', target: 'b', instant: false })
    expect(softFocusReducer(out, { type: 'change', target: 'a', instant: false })).toEqual({ shown: 'a', pending: null, phase: 'in' })
    expect(softFocusReducer(out, { type: 'change', target: 'c', instant: false })).toEqual({ shown: 'a', pending: 'c', phase: 'out' })
  })

  it('等首帧时又切换：重新虚化，退场后换成最新目标', () => {
    const wait: SoftFocusState<string> = { shown: 'b', pending: null, phase: 'wait' }
    const s = softFocusReducer(wait, { type: 'change', target: 'c', instant: false })
    expect(s).toEqual({ shown: 'b', pending: 'c', phase: 'out' })
    expect(softFocusReducer(s, { type: 'outDone' })).toEqual({ shown: 'c', pending: null, phase: 'wait' })
  })

  it('过期事件不改变状态', () => {
    expect(softFocusReducer(idle, { type: 'outDone' })).toBe(idle)
    expect(softFocusReducer(idle, { type: 'ready' })).toBe(idle)
    expect(softFocusReducer(idle, { type: 'inDone' })).toBe(idle)
    expect(softFocusReducer(idle, { type: 'change', target: 'a', instant: false })).toBe(idle)
  })
})
