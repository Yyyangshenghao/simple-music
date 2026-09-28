import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  advance: vi.fn(),
  clock: { elapsedTime: 0 },
  cleanups: [] as Array<() => void>
}))

vi.mock('react', () => ({
  useEffect: (effect: () => void | (() => void)) => {
    const cleanup = effect()
    if (cleanup) harness.cleanups.push(cleanup)
  }
}))
vi.mock('@react-three/fiber', () => ({
  useThree: (selector: (state: { advance: typeof harness.advance; clock: typeof harness.clock }) => unknown) => selector(harness)
}))

import { FrameLimiter } from './FrameLimiter'

describe('FrameLimiter', () => {
  let nextId = 0
  let callbacks: Map<number, FrameRequestCallback>
  let visibility: { hidden: boolean }

  function tick(now: number) {
    const pending = [...callbacks.values()]
    callbacks.clear()
    pending.forEach(callback => callback(now))
  }

  beforeEach(() => {
    callbacks = new Map()
    visibility = { hidden: false }
    harness.clock.elapsedTime = 0
    harness.advance.mockReset().mockImplementation((time: number) => { harness.clock.elapsedTime = time })
    vi.spyOn(performance, 'now').mockReturnValue(0)
    vi.stubGlobal('document', visibility)
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callbacks.set(++nextId, callback)
      return nextId
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id))
  })

  afterEach(() => {
    harness.cleanups.splice(0).forEach(cleanup => cleanup())
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it.each([30, 60, 120])('120Hz 屏幕限制 %i FPS 时，提前到达的回调不会多渲染一帧', fps => {
    FrameLimiter({ fps })
    const rendered: number[] = []
    for (let frame = 1; frame <= 120; frame++) {
      const before = harness.advance.mock.calls.length
      tick(frame * 1000 / 120 - 0.4)
      if (harness.advance.mock.calls.length > before) rendered.push(frame)
    }
    expect(rendered).toEqual(Array.from({ length: fps }, (_, index) => (index + 1) * 120 / fps))
  })

  it('长时间停顿后只渲染当前帧，不补发相邻帧', () => {
    FrameLimiter({ fps: 60 })
    tick(999.6)
    expect(harness.advance).toHaveBeenCalledTimes(1)
    tick(1000 + 1000 / 120 - 0.4)
    expect(harness.advance).toHaveBeenCalledTimes(1)
    tick(1000 + 1000 / 60 - 0.4)
    expect(harness.advance).toHaveBeenCalledTimes(2)
  })

  it('隐藏时不渲染，卸载时取消调度', () => {
    FrameLimiter({ fps: 60 })
    visibility.hidden = true
    tick(100)
    expect(harness.advance).not.toHaveBeenCalled()
    visibility.hidden = false
    tick(200)
    expect(harness.advance).toHaveBeenCalledOnce()
    harness.cleanups.splice(0).forEach(cleanup => cleanup())
    expect(callbacks.size).toBe(0)
  })

  it('不限帧时不启动额外调度', () => {
    FrameLimiter({ fps: 0 })
    expect(callbacks.size).toBe(0)
  })

  it('使用相对秒推进时钟，切换帧率后保持连续', () => {
    harness.clock.elapsedTime = 12
    vi.mocked(performance.now).mockReturnValue(100000)
    FrameLimiter({ fps: 60 })
    tick(100020)
    expect(harness.advance).toHaveBeenLastCalledWith(12.02)

    harness.cleanups.splice(0).forEach(cleanup => cleanup())
    vi.mocked(performance.now).mockReturnValue(100020)
    FrameLimiter({ fps: 30 })
    tick(100060)
    expect(harness.clock.elapsedTime).toBeCloseTo(12.06)
  })

  it('后台回调重置时基，长时间停顿最多推进 0.1 秒', () => {
    FrameLimiter({ fps: 60 })
    tick(20)
    visibility.hidden = true
    tick(5000)
    visibility.hidden = false
    tick(5020)
    expect(harness.advance).toHaveBeenLastCalledWith(0.04)
    tick(10000)
    expect(harness.clock.elapsedTime).toBeCloseTo(0.14)
  })
})
