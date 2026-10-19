import { afterEach, expect, it, vi } from 'vitest'
import { LIST_SCROLL_IDLE_MS, observeCardScrollActivity, observeListScrollActivity } from './list-scroll-activity'

afterEach(() => vi.useRealTimers())

it('间歇滚轮不反复恢复悬停，停止后主动移动指针才恢复', () => {
  vi.useFakeTimers()
  const viewport = new EventTarget()
  const change = vi.fn()
  const stop = observeCardScrollActivity(viewport, change)
  for (let i = 0; i < 10; i++) {
    viewport.dispatchEvent(new Event('wheel'))
    viewport.dispatchEvent(new Event('pointermove'))
    vi.advanceTimersByTime(450)
  }
  expect(change.mock.calls).toEqual([[true]])
  viewport.dispatchEvent(new Event('pointermove'))
  viewport.dispatchEvent(new Event('pointermove'))
  expect(change.mock.calls).toEqual([[true], [false]])
  stop()
})

it.each(['focusin', 'pointerdown'])('停止后通过 %s 恢复交互，卸载清理所有监听和计时器', (type) => {
  vi.useFakeTimers()
  const viewport = new EventTarget()
  const change = vi.fn()
  const stop = observeCardScrollActivity(viewport, change)
  viewport.dispatchEvent(new Event('scroll'))
  viewport.dispatchEvent(new Event(type))
  expect(change.mock.calls).toEqual([[true]])
  vi.advanceTimersByTime(LIST_SCROLL_IDLE_MS)
  viewport.dispatchEvent(new Event(type))
  expect(change.mock.calls).toEqual([[true], [false]])
  viewport.dispatchEvent(new Event('wheel'))
  stop()
  vi.advanceTimersByTime(LIST_SCROLL_IDLE_MS)
  for (const event of ['wheel', 'scroll', 'pointermove', 'pointerdown', 'focusin']) viewport.dispatchEvent(new Event(event))
  expect(change.mock.calls).toEqual([[true], [false], [true]])
  expect(vi.getTimerCount()).toBe(0)
})

it('探索页可从滚轮开始暂停，边界无位移也会恢复，卸载释放滚轮监听', () => {
  vi.useFakeTimers()
  const viewport = new EventTarget()
  const change = vi.fn()
  const stop = observeListScrollActivity(viewport, change, { wheel: true })
  viewport.dispatchEvent(new Event('wheel'))
  expect(change.mock.calls).toEqual([[true]])
  vi.advanceTimersByTime(LIST_SCROLL_IDLE_MS)
  expect(change.mock.calls).toEqual([[true], [false]])
  viewport.dispatchEvent(new Event('wheel'))
  stop()
  vi.advanceTimersByTime(LIST_SCROLL_IDLE_MS)
  viewport.dispatchEvent(new Event('wheel'))
  expect(change.mock.calls).toEqual([[true], [false], [true]])
  expect(vi.getTimerCount()).toBe(0)
})

it('快速经过多段只通知滚动开始，停留后才恢复查询', () => {
  vi.useFakeTimers()
  const viewport = new EventTarget()
  const change = vi.fn()
  const stop = observeListScrollActivity(viewport, change)
  viewport.dispatchEvent(new Event('wheel'))
  expect(change).not.toHaveBeenCalled()
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
