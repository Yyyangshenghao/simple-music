import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useReducedMotion } from './useReducedMotion'

const h = vi.hoisted(() => ({
  cleanup: undefined as (() => void) | undefined,
  snapshot: false,
  server: false,
  notify: vi.fn(),
}))
vi.mock('react', () => ({
  useSyncExternalStore: (subscribe: (onChange: () => void) => () => void, getSnapshot: () => boolean, getServerSnapshot: () => boolean) => {
    if (h.server) return getServerSnapshot()
    h.cleanup ??= subscribe(() => { h.snapshot = getSnapshot(); h.notify(h.snapshot) })
    return getSnapshot()
  },
}))

const listeners = new Set<() => void>()
const media = {
  matches: false,
  addEventListener: (_event: string, listener: () => void) => listeners.add(listener),
  removeEventListener: (_event: string, listener: () => void) => listeners.delete(listener),
}
beforeEach(() => {
  h.cleanup = undefined
  h.server = h.snapshot = media.matches = false
  h.notify.mockClear()
  listeners.clear()
  vi.stubGlobal('window', { matchMedia: () => media })
})
afterEach(() => { h.cleanup?.(); vi.unstubAllGlobals() })

describe('系统减少动态偏好', () => {
  it('运行中切换会通知订阅者，卸载后解除监听', () => {
    expect(useReducedMotion()).toBe(false)
    media.matches = true
    listeners.forEach(listener => listener())
    expect(h.notify).toHaveBeenLastCalledWith(true)
    expect(useReducedMotion()).toBe(true)
    media.matches = false
    listeners.forEach(listener => listener())
    expect(h.notify).toHaveBeenLastCalledWith(false)
    expect(useReducedMotion()).toBe(false)
    h.cleanup?.()
    expect(listeners.size).toBe(0)
  })

  it('启动时读取当前偏好，服务端与没有 matchMedia 的环境安全回退', () => {
    media.matches = true
    expect(useReducedMotion()).toBe(true)
    h.server = true
    expect(useReducedMotion()).toBe(false)
    h.server = false
    vi.stubGlobal('window', {})
    expect(useReducedMotion()).toBe(false)
    vi.stubGlobal('window', undefined)
    expect(useReducedMotion()).toBe(false)
  })
})
