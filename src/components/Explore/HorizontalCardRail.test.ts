import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { HorizontalCardRail, observeHorizontalCardRail } from './HorizontalCardRail'

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
  it('列表首部、中部和末尾均不拦截普通纵向滚轮，也不把它换算成横移', () => {
    const viewport = new Viewport()
    const cleanup = observe(viewport)
    for (const left of [0, 250, 600]) {
      viewport.scrollLeft = left
      for (const deltaMode of [0, 1, 2]) {
        for (const deltaY of [-40, 40]) {
          expect(wheel(viewport, { deltaY, deltaMode }).defaultPrevented).toBe(false)
          expect(viewport.scrollLeft).toBe(left)
        }
      }
    }
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

  it('初始未溢出时保留键盘入口且不显示导航', () => {
    const html = renderToStaticMarkup(createElement(HorizontalCardRail, { label: '你的歌单', children: '测试内容' }))
    expect(html).toContain('tabindex="0"')
    expect(html).toContain('data-arrow-navigation="true"')
    expect(html).toContain('aria-label="你的歌单"')
    expect(html).not.toContain('<button')
    expect(html).not.toContain('role="slider"')
    expect(html).not.toContain('<input')
    expect(html).not.toContain('上一页')
    expect(html).not.toContain('下一页')
  })
})
