import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useLightTheme } from './useLightTheme'

const h = vi.hoisted(() => ({
  mode: 'auto' as 'auto' | 'light' | 'dark',
  state: undefined as boolean | undefined,
  effect: undefined as (() => (() => void) | undefined) | undefined
}))
vi.mock('../stores/settings', () => ({
  useSettingsStore: (selector: (state: { themeMode: string }) => unknown) => selector({ themeMode: h.mode })
}))
vi.mock('react', () => ({
  useState: (initial: boolean) => {
    h.state ??= initial
    return [h.state, (value: boolean) => { h.state = value }]
  },
  useEffect: (effect: typeof h.effect) => { h.effect = effect }
}))

const listeners = new Set<() => void>()
const media = {
  matches: false,
  addEventListener: (_event: string, listener: () => void) => listeners.add(listener),
  removeEventListener: (_event: string, listener: () => void) => listeners.delete(listener)
}
beforeEach(() => {
  h.mode = 'auto'
  h.state = undefined
  h.effect = undefined
  media.matches = false
  listeners.clear()
  vi.stubGlobal('window', { matchMedia: () => media })
})
afterEach(() => vi.unstubAllGlobals())

describe('Canvas 与界面主题同步', () => {
  it('手动主题优先于系统外观', () => {
    h.mode = 'light'
    expect(useLightTheme()).toBe(true)
    h.effect?.()
    media.matches = true
    h.mode = 'dark'
    expect(useLightTheme()).toBe(false)
    h.effect?.()
    expect(listeners.size).toBe(0)
  })

  it('auto 跟随系统变化，卸载后不再监听', () => {
    expect(useLightTheme()).toBe(false)
    const cleanup = h.effect?.()
    media.matches = true
    listeners.forEach(listener => listener())
    expect(useLightTheme()).toBe(true)
    media.matches = false
    listeners.forEach(listener => listener())
    expect(useLightTheme()).toBe(false)
    cleanup?.()
    expect(listeners.size).toBe(0)
  })

  it('没有浏览器环境时默认深色，不注册监听', () => {
    vi.stubGlobal('window', undefined)
    expect(useLightTheme()).toBe(false)
    expect(h.effect?.()).toBeUndefined()
  })
})
