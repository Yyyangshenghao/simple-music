import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useSystemReducedMotion } from './useSystemReducedMotion'
const h = vi.hoisted(() => ({ value: undefined as boolean | undefined, effect: undefined as (() => (() => void) | undefined) | undefined }))
vi.mock('react', () => ({
  useState: (initial: () => boolean) => { h.value ??= initial(); return [h.value, (value: boolean) => { h.value = value }] },
  useEffect: (effect: typeof h.effect) => { h.effect = effect },
}))
const listeners = new Set<() => void>()
const media = { matches: false, addEventListener: (_type: string, listener: () => void) => listeners.add(listener), removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener) }
beforeEach(() => { h.value = undefined; h.effect = undefined; listeners.clear(); media.matches = false; vi.stubGlobal('window', { matchMedia: () => media }) })
afterEach(() => vi.unstubAllGlobals())
it('运行中切换系统减弱动态立即生效，卸载后移除监听', () => {
  expect(useSystemReducedMotion()).toBe(false)
  const cleanup = h.effect?.()
  media.matches = true
  listeners.forEach(listener => listener())
  expect(useSystemReducedMotion()).toBe(true)
  media.matches = false
  listeners.forEach(listener => listener())
  expect(useSystemReducedMotion()).toBe(false)
  cleanup?.()
  expect(listeners.size).toBe(0)
})
it('没有浏览器环境时不注册监听', () => {
  vi.stubGlobal('window', undefined)
  expect(useSystemReducedMotion()).toBe(false)
  expect(h.effect?.()).toBeUndefined()
})
