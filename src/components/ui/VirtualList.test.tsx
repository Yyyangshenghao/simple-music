import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { LIST_SCROLL_IDLE_MS } from './list-scroll-activity'

const h = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, effects: [] as (() => void)[], inner: null as unknown }))
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useRef: (initial: unknown) => {
    const index = h.cursor++
    return h.slots[index] ??= { current: index === 0 ? h.inner : initial }
  },
  useState: (initial: unknown) => {
    const index = h.cursor++
    if (!(index in h.slots)) h.slots[index] = initial
    return [h.slots[index], (next: unknown) => { h.slots[index] = next }]
  },
  useEffect: (effect: () => void | (() => void), deps: unknown[]) => {
    const index = h.cursor++
    const previous = h.slots[index] as { deps: unknown[]; cleanup?: () => void } | undefined
    if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) h.effects.push(() => {
      previous?.cleanup?.()
      h.slots[index] = { deps, cleanup: effect() }
    })
  },
}))
import { VirtualList } from './VirtualList'

class Viewport extends EventTarget {
  scrollTop = 0
  clientHeight = 560
  getBoundingClientRect() { return { top: 0 } }
}
let viewport: Viewport
let scrollRef: { current: HTMLElement }
const callback = vi.fn()
function render(total = 870) {
  h.cursor = 0
  const tree = VirtualList({ total, rowHeight: 56, scrollRef, onRangeChange: callback, renderRow: i => i })
  h.effects.splice(0).forEach(effect => effect())
  return tree
}
beforeEach(() => {
  vi.useFakeTimers()
  h.slots = []; h.effects = []
  viewport = new Viewport()
  scrollRef = { current: viewport as unknown as HTMLElement }
  h.inner = { getBoundingClientRect: () => ({ top: 200 - viewport.scrollTop }) }
  callback.mockClear()
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('requestAnimationFrame', (fn: () => void) => setTimeout(fn, 16))
  vi.stubGlobal('cancelAnimationFrame', clearTimeout)
  render(); render()
  callback.mockClear()
})
afterEach(() => {
  for (const slot of h.slots) (slot as { cleanup?: () => void } | undefined)?.cleanup?.()
  vi.unstubAllGlobals(); vi.useRealTimers()
})

it('快速经过多个窗口时立即更新可视行，但只补最终停留区段', () => {
  for (const top of [6000, 18000, 33000, 47000]) {
    viewport.scrollTop = top
    viewport.dispatchEvent(new Event('scroll'))
    vi.advanceTimersByTime(30)
    render()
  }
  expect(callback).not.toHaveBeenCalled()
  vi.advanceTimersByTime(LIST_SCROLL_IDLE_MS)
  render()
  expect(callback).toHaveBeenCalledTimes(1)
  expect(callback.mock.calls[0][0]).toBeGreaterThan(800)
})

it('滚动中切换为短列表会清掉旧滚动状态，仍可查询新可见区段', () => {
  viewport.scrollTop = 6000
  viewport.dispatchEvent(new Event('scroll'))
  vi.advanceTimersByTime(30)
  render()
  viewport.scrollTop = 0
  render(5); render(5)
  expect(callback).toHaveBeenLastCalledWith(0, 5)
  expect(vi.getTimerCount()).toBe(0)
})
