import { afterEach, expect, it, vi } from 'vitest'
import { LIST_SCROLL_IDLE_MS, observeListScrollActivity } from './list-scroll-activity'

afterEach(() => vi.useRealTimers())

it('快速经过多段只通知滚动开始，停留后才恢复查询', () => {
  vi.useFakeTimers()
  const viewport = new EventTarget()
  const change = vi.fn()
  const stop = observeListScrollActivity(viewport, change)
  for (let i = 0; i < 20; i++) {
    viewport.dispatchEvent(new Event('scroll'))
    vi.advanceTimersByTime(30)
  }
  expect(change.mock.calls).toEqual([[true]])
  vi.advanceTimersByTime(LIST_SCROLL_IDLE_MS)
  expect(change.mock.calls).toEqual([[true], [false]])
  stop()
})

it('卸载释放计时器和监听，不再恢复已离开的列表', () => {
  vi.useFakeTimers()
  const viewport = new EventTarget()
  const change = vi.fn()
  const stop = observeListScrollActivity(viewport, change)
  viewport.dispatchEvent(new Event('scroll'))
  stop()
  vi.advanceTimersByTime(LIST_SCROLL_IDLE_MS)
  viewport.dispatchEvent(new Event('scroll'))
  expect(change.mock.calls).toEqual([[true]])
  expect(vi.getTimerCount()).toBe(0)
})
