import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  cover: 'first.jpg' as string | undefined,
  view: 'explore' as string,
  dependencies: undefined as unknown[] | undefined,
  cleanup: undefined as (() => void) | undefined,
  palette: vi.fn(() => ['#112233', '#445566', '#778899']),
  luma: vi.fn(() => 0.7)
}))

vi.mock('react', () => ({
  useEffect: (effect: () => (() => void) | undefined, dependencies: unknown[]) => {
    if (h.dependencies && dependencies.every((value, index) => Object.is(value, h.dependencies![index]))) return
    h.cleanup?.()
    h.dependencies = dependencies
    h.cleanup = effect()
  }
}))
vi.mock('../stores/player', () => ({
  usePlayerStore: (selector: (state: unknown) => unknown) => selector({ currentTrack: { cover: h.cover } })
}))
vi.mock('../stores/navigation', () => ({
  useNavigationStore: (selector: (state: unknown) => unknown) => selector({ currentView: h.view })
}))
vi.mock('../lib/api', () => ({ api: { coverImage: (url: string) => url } }))
vi.mock('../lib/extract-color', () => ({
  extractPalette: h.palette,
  extractLuma: h.luma,
  DEFAULT_PALETTE: ['#000000', '#000000', '#000000']
}))

import { useAmbientPalette } from './useAmbientPalette'

class TestImage {
  static instances: TestImage[] = []
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  crossOrigin = ''
  src = ''
  constructor() { TestImage.instances.push(this) }
}

describe('封面取色与导航', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    h.cover = 'first.jpg'
    h.view = 'explore'
    h.dependencies = undefined
    h.cleanup = undefined
    TestImage.instances = []
    vi.stubGlobal('Image', TestImage)
    vi.stubGlobal('document', { documentElement: { style: {
      getPropertyValue: () => '', setProperty: vi.fn()
    } } })
  })

  afterEach(() => {
    h.cleanup?.()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('普通切页不重复采样，退出刷歌时恢复封面取色', () => {
    useAmbientPalette()
    TestImage.instances[0].onload?.()
    expect(h.palette).toHaveBeenCalledTimes(1)
    h.view = 'library'
    useAmbientPalette()
    h.view = 'settings'
    useAmbientPalette()
    expect(TestImage.instances).toHaveLength(1)

    h.view = 'shuange'
    useAmbientPalette()
    expect(vi.getTimerCount()).toBe(0)
    expect(TestImage.instances).toHaveLength(1)
    h.view = 'explore'
    useAmbientPalette()
    expect(TestImage.instances).toHaveLength(2)
    TestImage.instances[1].onload?.()
    expect(h.palette).toHaveBeenCalledTimes(2)
  })

  it('切歌丢弃旧图片结果，卸载和移除封面时释放补间', () => {
    useAmbientPalette()
    const oldLoad = TestImage.instances[0].onload!
    h.cover = 'second.jpg'
    useAmbientPalette()
    oldLoad()
    expect(h.palette).not.toHaveBeenCalled()
    TestImage.instances[1].onload?.()
    expect(vi.getTimerCount()).toBe(1)
    h.cleanup?.()
    expect(vi.getTimerCount()).toBe(0)

    h.cover = undefined
    useAmbientPalette()
    expect(vi.getTimerCount()).toBe(1)
    h.cleanup?.()
    expect(vi.getTimerCount()).toBe(0)
  })
})
