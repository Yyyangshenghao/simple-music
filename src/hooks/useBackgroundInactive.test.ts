import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useBackgroundInactive } from './useBackgroundInactive'

const h = vi.hoisted(() => ({
  state: undefined as boolean | undefined,
  effect: null as { deps: unknown[]; cleanup?: () => void } | null,
  windowListeners: new Map<string, EventListener>(),
  documentListeners: new Map<string, EventListener>(),
  focused: true,
  hidden: false,
}))

vi.mock('react', () => ({
  useState: (initial: boolean | (() => boolean)) => {
    h.state ??= typeof initial === 'function' ? initial() : initial
    return [h.state, (value: boolean) => { h.state = value }] as const
  },
  useEffect: (effect: () => (() => void) | undefined, deps: unknown[]) => {
    if (h.effect && deps.every((value, index) => Object.is(value, h.effect?.deps[index]))) return
    h.effect?.cleanup?.()
    h.effect = { deps, cleanup: effect() }
  }
}))

function fire(map: Map<string, EventListener>, name: string): void {
  map.get(name)?.({} as Event)
}

beforeEach(() => {
  h.state = undefined
  h.effect = null
  h.windowListeners.clear()
  h.documentListeners.clear()
  h.focused = true
  h.hidden = false
  vi.stubGlobal('window', {
    addEventListener: (name: string, callback: EventListener) => h.windowListeners.set(name, callback),
    removeEventListener: (name: string) => h.windowListeners.delete(name),
  })
  vi.stubGlobal('document', {
    get hidden() { return h.hidden },
    hasFocus: () => h.focused,
    addEventListener: (name: string, callback: EventListener) => h.documentListeners.set(name, callback),
    removeEventListener: (name: string) => h.documentListeners.delete(name),
  })
})

afterEach(() => vi.unstubAllGlobals())

describe('背景失焦暂停', () => {
  it('开启时失焦与隐藏都算停帧，回到前台恢复', () => {
    expect(useBackgroundInactive(true)).toBe(false)
    h.focused = false
    fire(h.windowListeners, 'blur')
    expect(useBackgroundInactive(true)).toBe(true)
    h.focused = true
    fire(h.windowListeners, 'focus')
    expect(useBackgroundInactive(true)).toBe(false)
    h.hidden = true
    fire(h.documentListeners, 'visibilitychange')
    expect(useBackgroundInactive(true)).toBe(true)
  })

  it('关闭后失焦继续播放，最小化或隐藏仍然停帧', () => {
    expect(useBackgroundInactive(false)).toBe(false)
    h.focused = false
    fire(h.windowListeners, 'blur')
    expect(useBackgroundInactive(false)).toBe(false)
    h.hidden = true
    fire(h.documentListeners, 'visibilitychange')
    expect(useBackgroundInactive(false)).toBe(true)
    h.hidden = false
    fire(h.documentListeners, 'visibilitychange')
    expect(useBackgroundInactive(false)).toBe(false)
  })

  it('切换开关不等焦点事件，立即按当前窗口状态对齐', () => {
    useBackgroundInactive(true)
    h.focused = false
    fire(h.windowListeners, 'blur')
    expect(useBackgroundInactive(true)).toBe(true)
    useBackgroundInactive(false)
    expect(useBackgroundInactive(false)).toBe(false)
    useBackgroundInactive(true)
    expect(useBackgroundInactive(true)).toBe(true)
  })
})
