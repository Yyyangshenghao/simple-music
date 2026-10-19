import type { RefObject } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ScrollArea } from './ScrollArea'
import { CARD_POINTER_RESUME_MS, LIST_SCROLL_IDLE_MS } from './list-scroll-activity'

const h = vi.hoisted(() => ({ change: vi.fn(), cleanups: [] as Array<() => void> }))
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useRef: (current: unknown) => ({ current }),
  useState: (initial: unknown) => [initial, h.change],
  useEffect: (effect: () => (() => void) | void) => {
    const cleanup = effect()
    if (cleanup) h.cleanups.push(cleanup)
  },
}))

class Viewport extends EventTarget { scrollTop = 0 }
function render(viewport: Viewport, pauseCardEffects = false, onScrolledChange = vi.fn()) {
  return ScrollArea({ children: '卡片', scrollRef: { current: viewport } as unknown as RefObject<HTMLDivElement>, pauseCardEffects, onScrolledChange })
}
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks() })
afterEach(() => { h.cleanups.splice(0).forEach(cleanup => cleanup()); vi.useRealTimers() })

it('主动启用后在滚轮开始时暂停，停止后移动指针才恢复，卸载不再接收事件', () => {
  const viewport = new Viewport()
  render(viewport, true)
  h.change.mockClear()
  viewport.dispatchEvent(new Event('wheel'))
  viewport.dispatchEvent(new Event('scroll'))
  expect(h.change.mock.calls).toEqual([[true]])
  vi.advanceTimersByTime(LIST_SCROLL_IDLE_MS + CARD_POINTER_RESUME_MS)
  expect(h.change.mock.calls).toEqual([[true]])
  viewport.dispatchEvent(new Event('pointermove'))
  expect(h.change.mock.calls).toEqual([[true], [false]])
  viewport.dispatchEvent(new Event('wheel'))
  h.cleanups.splice(0).forEach(cleanup => cleanup())
  vi.advanceTimersByTime(LIST_SCROLL_IDLE_MS)
  viewport.dispatchEvent(new Event('wheel'))
  expect(h.change.mock.calls).toEqual([[true], [false], [true]])
  expect(vi.getTimerCount()).toBe(0)
})

it('默认不接管卡片动效，仍只在跨越原有滚动阈值时通知', () => {
  const viewport = new Viewport()
  const scrolled = vi.fn()
  render(viewport, false, scrolled)
  viewport.dispatchEvent(new Event('wheel'))
  viewport.scrollTop = 10
  viewport.dispatchEvent(new Event('scroll'))
  viewport.scrollTop = 20
  viewport.dispatchEvent(new Event('scroll'))
  viewport.scrollTop = 0
  viewport.dispatchEvent(new Event('scroll'))
  expect(scrolled.mock.calls).toEqual([[false], [true], [false]])
  expect(h.change).not.toHaveBeenCalled()
})
