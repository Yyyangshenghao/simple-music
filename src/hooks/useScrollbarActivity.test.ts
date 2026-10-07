import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ cleanups: [] as Array<() => void> }))
vi.mock('react', () => ({ useEffect: (effect: () => () => void) => { h.cleanups.push(effect()) } }))
import { useScrollbarActivity } from './useScrollbarActivity'

class ScrollElement {
  private attributes = new Set<string>()
  setAttribute(name: string) { this.attributes.add(name) }
  removeAttribute(name: string) { this.attributes.delete(name) }
  hasAttribute(name: string) { return this.attributes.has(name) }
}

let onScroll: (event: Event) => void
let removeListener: ReturnType<typeof vi.fn>
function scroll(target: object) {
  onScroll({ target } as unknown as Event)
}

beforeEach(() => {
  vi.useFakeTimers()
  removeListener = vi.fn()
  vi.stubGlobal('HTMLElement', ScrollElement)
  vi.stubGlobal('document', {
    addEventListener: (type: string, listener: typeof onScroll, capture: boolean) => {
      expect(type).toBe('scroll')
      expect(capture).toBe(true)
      onScroll = listener
    },
    removeEventListener: removeListener,
  })
  useScrollbarActivity()
})

afterEach(() => {
  h.cleanups.splice(0).forEach(cleanup => cleanup())
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('统一滚动条显隐', () => {
  it('捕获内层滚动，停止 800ms 后收起', () => {
    const el = new ScrollElement()
    scroll(el)
    expect(el.hasAttribute('data-sm-scrolling')).toBe(true)
    vi.advanceTimersByTime(799)
    expect(el.hasAttribute('data-sm-scrolling')).toBe(true)
    vi.advanceTimersByTime(1)
    expect(el.hasAttribute('data-sm-scrolling')).toBe(false)
  })

  it('连续滚动从最后一次活动重新计时', () => {
    const el = new ScrollElement()
    scroll(el)
    vi.advanceTimersByTime(600)
    scroll(el)
    vi.advanceTimersByTime(600)
    expect(el.hasAttribute('data-sm-scrolling')).toBe(true)
    vi.advanceTimersByTime(200)
    expect(el.hasAttribute('data-sm-scrolling')).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('外层页面与内层弹窗分别计时', () => {
    const page = new ScrollElement()
    const popup = new ScrollElement()
    scroll(page)
    vi.advanceTimersByTime(400)
    scroll(popup)
    vi.advanceTimersByTime(400)
    expect(page.hasAttribute('data-sm-scrolling')).toBe(false)
    expect(popup.hasAttribute('data-sm-scrolling')).toBe(true)
    vi.advanceTimersByTime(400)
    expect(popup.hasAttribute('data-sm-scrolling')).toBe(false)
  })

  it('忽略 document 等非元素事件', () => {
    scroll(document)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('卸载时释放监听、计时器和全部活动标记', () => {
    const first = new ScrollElement()
    const second = new ScrollElement()
    scroll(first)
    scroll(second)
    h.cleanups.splice(0).forEach(cleanup => cleanup())
    expect(removeListener).toHaveBeenCalledWith('scroll', onScroll, true)
    expect(first.hasAttribute('data-sm-scrolling')).toBe(false)
    expect(second.hasAttribute('data-sm-scrolling')).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })
})
