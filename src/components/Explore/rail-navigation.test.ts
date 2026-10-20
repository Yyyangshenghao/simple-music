import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bindRailDrag, measureRail, railProgress } from './rail-navigation'

class Viewport extends EventTarget {
  scrollWidth = 1642
  clientWidth = 682
  scrollLeft = 0
  children = Array.from({ length: 10 }, (_, i) => ({ offsetLeft: 21 + i * 160 }))
  dataset: Record<string, string> = {}
  capture: number | null = null
  closest = () => null
  setPointerCapture = (id: number) => { this.capture = id }
  hasPointerCapture = (id: number) => this.capture === id
  releasePointerCapture = () => { this.capture = null }
}
function pointer(viewport: Viewport, type: string, x: number, values: Record<string, unknown> = {}) {
  const event = new Event(type, { cancelable: true })
  Object.defineProperties(event, Object.fromEntries(Object.entries({ pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1, clientX: x, clientY: 0, timeStamp: 100, ...values }).map(([key, value]) => [key, { value }])))
  viewport.dispatchEvent(event)
  return event
}
function click(viewport: Viewport, detail = 1) {
  const event = new Event('click', { cancelable: true })
  Object.assign(event, { detail })
  viewport.dispatchEvent(event)
  return event
}
let animate: FrameRequestCallback | undefined
beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { animate = callback; return 1 }))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
})
afterEach(() => { vi.unstubAllGlobals(); animate = undefined })

describe('rail navigation', () => {
  it('按完整卡片分组并覆盖首尾，缩小或增大窗口重新计算', () => {
    const viewport = new Viewport()
    expect(measureRail(viewport as unknown as HTMLElement).pages).toEqual([0, 480, 960])
    viewport.clientWidth = 362
    expect(measureRail(viewport as unknown as HTMLElement).pages).toEqual([0, 160, 320, 480, 640, 800, 960, 1120, 1280])
    viewport.clientWidth = 1642
    expect(measureRail(viewport as unknown as HTMLElement).pages).toEqual([0])
  })

  it('点击和小幅移动继续打开卡片，横拖后拦截误点击，下一次点击正常', () => {
    const viewport = new Viewport()
    const control = bindRailDrag(viewport as unknown as HTMLElement, () => true)
    pointer(viewport, 'pointerdown', 300)
    pointer(viewport, 'pointermove', 296)
    pointer(viewport, 'pointerup', 296)
    expect(click(viewport).defaultPrevented).toBe(false)
    pointer(viewport, 'pointerdown', 300)
    expect(pointer(viewport, 'pointermove', 190).defaultPrevented).toBe(true)
    expect(viewport.scrollLeft).toBe(110)
    expect(viewport.capture).toBe(1)
    pointer(viewport, 'pointerup', 190, { timeStamp: 200 })
    expect(viewport.scrollLeft).toBe(160)
    expect(viewport.dataset.dragging).toBeUndefined()
    expect(click(viewport, 0).defaultPrevented).toBe(false)
    expect(click(viewport).defaultPrevented).toBe(true)
    pointer(viewport, 'pointerdown', 100)
    pointer(viewport, 'pointerup', 100)
    expect(click(viewport).defaultPrevented).toBe(false)
    control.dispose()
  })

  it('纵向意图、触控、右键不启动自定义拖动，滚轮不被拦截', () => {
    const viewport = new Viewport()
    const control = bindRailDrag(viewport as unknown as HTMLElement, () => false)
    pointer(viewport, 'pointerdown', 300)
    pointer(viewport, 'pointermove', 298, { clientY: 30 })
    pointer(viewport, 'pointermove', 100, { clientY: 40 })
    for (const values of [{ pointerType: 'touch' }, { button: 2 }]) {
      pointer(viewport, 'pointerdown', 300, values)
      expect(pointer(viewport, 'pointermove', 100, values).defaultPrevented).toBe(false)
    }
    expect(viewport.scrollLeft).toBe(0)
    const wheel = new Event('wheel', { cancelable: true })
    viewport.dispatchEvent(wheel)
    expect(wheel.defaultPrevented).toBe(false)
    expect(viewport.scrollLeft).toBe(0)
    control.dispose()
  })

  it('松手惯性停靠可被新输入中断，卸载取消帧和监听', () => {
    const viewport = new Viewport()
    const control = bindRailDrag(viewport as unknown as HTMLElement, () => false)
    pointer(viewport, 'pointerdown', 300)
    pointer(viewport, 'pointermove', 200, { timeStamp: 120 })
    pointer(viewport, 'pointerup', 200, { timeStamp: 125 })
    expect(requestAnimationFrame).toHaveBeenCalledOnce()
    animate?.(performance.now() + 400)
    expect(viewport.scrollLeft).toBe(640)
    pointer(viewport, 'pointerdown', 300)
    pointer(viewport, 'pointermove', 200)
    control.cancel()
    expect(viewport.capture).toBeNull()
    expect(viewport.dataset.dragging).toBeUndefined()
    control.dispose()
    const left = viewport.scrollLeft
    pointer(viewport, 'pointerdown', 300)
    pointer(viewport, 'pointermove', 100)
    expect(viewport.scrollLeft).toBe(left)
    expect(cancelAnimationFrame).toHaveBeenCalled()
  })

  it('不足一屏的尾组与各个导航标记准确对应', () => {
    const pages = [0, 480, 960, 1120]
    expect(pages.map(left => railProgress(pages, left))).toEqual([0, 1 / 3, 2 / 3, 1])
    expect(railProgress(pages, 1040)).toBeCloseTo(5 / 6)
    expect(railProgress([0], 0)).toBe(0)
  })

  it('阈值前移出并在外部松手，返回时不留下悬空拖动', () => {
    const viewport = new Viewport()
    const control = bindRailDrag(viewport as unknown as HTMLElement, () => false)
    pointer(viewport, 'pointerdown', 300)
    pointer(viewport, 'pointermove', 200, { buttons: 0 })
    expect(viewport.scrollLeft).toBe(0)
    expect(viewport.dataset.dragging).toBeUndefined()
    expect(viewport.capture).toBeNull()
    control.dispose()
  })

  it('取消拖动不会启动惯性', () => {
    const viewport = new Viewport()
    const control = bindRailDrag(viewport as unknown as HTMLElement, () => false)
    pointer(viewport, 'pointerdown', 300)
    pointer(viewport, 'pointermove', 200)
    pointer(viewport, 'pointercancel', 200)
    expect(requestAnimationFrame).not.toHaveBeenCalled()
    expect(viewport.capture).toBeNull()
    control.dispose()
  })
})
