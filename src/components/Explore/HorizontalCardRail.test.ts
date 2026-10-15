import { afterEach, describe, expect, it, vi } from 'vitest'
import { observeHorizontalCardRail, scrollHorizontalCardRailPage } from './HorizontalCardRail'

class Viewport extends EventTarget {
  scrollWidth = 1000
  clientWidth = 400
  scrollLeft = 0
  children = [new EventTarget()]
  scrollBy = vi.fn()
}

function wheel(viewport: Viewport, values: Partial<WheelEvent> = {}) {
  const event = new Event('wheel', { cancelable: true })
  Object.assign(event, { deltaX: 0, deltaY: 30, deltaMode: 0, ctrlKey: false, shiftKey: false }, values)
  viewport.dispatchEvent(event)
  return event
}

function observe(viewport: Viewport, callback = vi.fn()) {
  return observeHorizontalCardRail(viewport as unknown as HTMLElement, callback)
}

afterEach(() => { vi.unstubAllGlobals() })

describe('HorizontalCardRail interaction', () => {
  it('连续竖向滚轮累积横移，行与页单位按横排尺寸换算', () => {
    const viewport = new Viewport()
    const cleanup = observe(viewport)
    expect(wheel(viewport, { deltaY: 2 }).defaultPrevented).toBe(true)
    wheel(viewport, { deltaY: 2 })
    expect(viewport.scrollLeft).toBe(4)
    wheel(viewport, { deltaY: 2, deltaMode: 1 })
    expect(viewport.scrollLeft).toBe(36)
    wheel(viewport, { deltaY: 1, deltaMode: 2 })
    expect(viewport.scrollLeft).toBe(436)
    cleanup()
  })

  it('内容不足、首尾向外滚动时允许页面继续竖滚', () => {
    const viewport = new Viewport()
    const cleanup = observe(viewport)
    expect(wheel(viewport, { deltaY: -40 }).defaultPrevented).toBe(false)
    viewport.scrollLeft = 580
    expect(wheel(viewport, { deltaY: 40 }).defaultPrevented).toBe(true)
    expect(viewport.scrollLeft).toBe(600)
    expect(wheel(viewport).defaultPrevented).toBe(false)
    expect(wheel(viewport, { deltaY: -40 }).defaultPrevented).toBe(true)
    expect(viewport.scrollLeft).toBe(560)
    viewport.scrollWidth = 300
    expect(wheel(viewport).defaultPrevented).toBe(false)
    cleanup()
  })

  it('保留原生横向手势、Shift 横滚和 Ctrl 缩放', () => {
    const viewport = new Viewport()
    const cleanup = observe(viewport)
    for (const values of [{ deltaX: 5 }, { shiftKey: true }, { ctrlKey: true }, { deltaY: 0 }]) {
      expect(wheel(viewport, values).defaultPrevented).toBe(false)
      expect(viewport.scrollLeft).toBe(0)
    }
    cleanup()
  })

  it('滚动及卡片尺寸变化更新两侧隐藏状态，卸载移除监听和观察', () => {
    const viewport = new Viewport()
    const callback = vi.fn()
    let resize = () => {}
    const observeSize = vi.fn()
    const disconnect = vi.fn()
    vi.stubGlobal('ResizeObserver', class {
      constructor(onResize: () => void) { resize = onResize }
      observe = observeSize
      disconnect = disconnect
    })
    const cleanup = observe(viewport, callback)
    expect(callback).toHaveBeenLastCalledWith({ previous: false, next: true })
    expect(observeSize.mock.calls.map(([target]) => target)).toEqual([viewport, ...viewport.children])
    viewport.scrollLeft = 250
    viewport.dispatchEvent(new Event('scroll'))
    expect(callback).toHaveBeenLastCalledWith({ previous: true, next: true })
    viewport.scrollLeft = 600
    viewport.dispatchEvent(new Event('scroll'))
    expect(callback).toHaveBeenLastCalledWith({ previous: true, next: false })
    viewport.scrollWidth = 400
    resize()
    expect(callback).toHaveBeenLastCalledWith({ previous: false, next: false })
    cleanup()
    expect(disconnect).toHaveBeenCalledOnce()
    callback.mockClear()
    viewport.scrollWidth = 1000
    viewport.scrollLeft = 0
    viewport.dispatchEvent(new Event('scroll'))
    expect(wheel(viewport).defaultPrevented).toBe(false)
    expect(callback).not.toHaveBeenCalled()
    expect(viewport.scrollLeft).toBe(0)
  })

  it('翻页约一屏，减少动画偏好使用即时滚动', () => {
    const viewport = new Viewport()
    scrollHorizontalCardRailPage(viewport as unknown as HTMLElement, 1, false)
    expect(viewport.scrollBy).toHaveBeenLastCalledWith({ left: 340, behavior: 'smooth' })
    scrollHorizontalCardRailPage(viewport as unknown as HTMLElement, -1, true)
    expect(viewport.scrollBy).toHaveBeenLastCalledWith({ left: -340, behavior: 'auto' })
  })
})
