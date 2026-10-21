import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  palette: ['#112233', '#445566', '#778899'],
  view: 'explore' as string,
  dependencies: undefined as unknown[] | undefined,
  cleanup: undefined as (() => void) | undefined,
  reducedMotion: false,
}))
vi.mock('./useReducedMotion', () => ({ useReducedMotion: () => h.reducedMotion }))
vi.mock('react', () => ({
  useEffect: (effect: () => (() => void) | undefined, dependencies: unknown[]) => {
    if (h.dependencies && dependencies.every((value, index) => Object.is(value, h.dependencies![index]))) return
    h.cleanup?.()
    h.dependencies = dependencies
    h.cleanup = effect()
  }
}))
vi.mock('../stores/ambient', () => ({
  useAmbientStore: (selector: (state: unknown) => unknown) => selector({ palette: h.palette })
}))
vi.mock('../stores/navigation', () => ({
  useNavigationStore: (selector: (state: unknown) => unknown) => selector({ currentView: h.view })
}))
import { useAmbientPalette } from './useAmbientPalette'

const setProperty = vi.fn()
beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  h.palette = ['#112233', '#445566', '#778899']
  h.view = 'explore'
  h.reducedMotion = false
  h.dependencies = undefined
  h.cleanup = undefined
  vi.stubGlobal('document', { documentElement: { style: {
    getPropertyValue: () => '#000000', setProperty
  } } })
})
afterEach(() => {
  h.cleanup?.()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('界面消费氛围色', () => {
  it('运行中减少动态会停止补间计时器并直接应用最新颜色', () => {
    useAmbientPalette()
    expect(vi.getTimerCount()).toBe(1)
    h.reducedMotion = true
    useAmbientPalette()
    expect(vi.getTimerCount()).toBe(0)
    expect(setProperty.mock.calls.slice(-3)).toEqual([
      ['--ambient-1', '#112233'], ['--ambient-2', '#445566'], ['--ambient-3', '#778899']
    ])
    h.reducedMotion = false
    useAmbientPalette()
    expect(vi.getTimerCount()).toBe(1)
  })
  it('只把已有颜色补间为12步，普通切页不重启，完成时准确落到目标色', () => {
    useAmbientPalette()
    vi.advanceTimersByTime(66)
    const first = setProperty.mock.calls[0][1]
    expect(first).not.toBe('#112233')
    expect(first).not.toBe('#000000')
    h.view = 'library'
    useAmbientPalette()
    h.view = 'settings'
    useAmbientPalette()
    vi.advanceTimersByTime(66 * 11)
    expect(setProperty).toHaveBeenCalledTimes(36)
    expect(setProperty.mock.calls.slice(-3)).toEqual([
      ['--ambient-1', '#112233'], ['--ambient-2', '#445566'], ['--ambient-3', '#778899']
    ])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('游戏或刷歌停止补间，恢复时消费最新颜色', () => {
    useAmbientPalette()
    vi.advanceTimersByTime(66)
    useAmbientPalette(false)
    expect(vi.getTimerCount()).toBe(0)
    h.palette = ['#abcdef', '#123456', '#987654']
    useAmbientPalette(false)
    vi.advanceTimersByTime(1000)
    expect(setProperty).toHaveBeenCalledTimes(3)
    h.view = 'shuange'
    useAmbientPalette(true)
    expect(vi.getTimerCount()).toBe(0)
    h.view = 'explore'
    useAmbientPalette(true)
    vi.advanceTimersByTime(66 * 12)
    expect(setProperty).toHaveBeenLastCalledWith('--ambient-3', '#987654')
  })

  it('卸载清理补间，重挂直接消费最新颜色，不创建图片或修改store', () => {
    useAmbientPalette()
    h.cleanup?.()
    h.dependencies = undefined
    expect(vi.getTimerCount()).toBe(0)
    h.palette = ['#aabbcc', '#ddeeff', '#123456']
    useAmbientPalette()
    vi.advanceTimersByTime(66 * 12)
    expect(setProperty.mock.calls.slice(-3)).toEqual([
      ['--ambient-1', '#aabbcc'], ['--ambient-2', '#ddeeff'], ['--ambient-3', '#123456']
    ])
  })
})
