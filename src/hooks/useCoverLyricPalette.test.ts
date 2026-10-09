import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCoverLyricPalette } from './useCoverLyricPalette'
import { silverBlueLyricPalette } from '../lib/lyric-palette'

const h = vi.hoisted(() => ({
  state: undefined as unknown,
  effect: undefined as (() => (() => void) | undefined) | undefined
}))
vi.mock('react', () => ({
  useState: (initial: () => unknown) => {
    h.state ??= initial()
    return [h.state, (value: unknown) => { h.state = value }]
  },
  useEffect: (effect: typeof h.effect) => { h.effect = effect }
}))
vi.mock('../lib/api', () => ({ api: { coverImage: (url: string) => url } }))
vi.mock('../lib/image-size', () => ({ sizedImage: (url: string) => url, CANVAS_COVER_PX: 384 }))

const images: TestImage[] = []
class TestImage {
  src = ''
  crossOrigin = ''
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor() { images.push(this) }
}
beforeEach(() => {
  h.state = undefined
  h.effect = undefined
  images.length = 0
  const pixels = new Uint8ClampedArray(64 * 64 * 4)
  for (let i = 0; i < pixels.length; i += 4) pixels.set([40, 120, 220, 255], i)
  vi.stubGlobal('Image', TestImage)
  vi.stubGlobal('document', {
    createElement: () => ({ getContext: () => ({ drawImage: vi.fn(), getImageData: () => ({ data: pixels }) }) })
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('歌词封面取色生命周期', () => {
  it('切歌立即丢弃旧色，旧封面迟到也不能覆盖当前结果', () => {
    useCoverLyricPalette('first')
    const cleanup = h.effect?.()
    const lateLoad = images[0].onload!
    lateLoad()
    expect(useCoverLyricPalette('first')).not.toEqual(silverBlueLyricPalette())
    expect(useCoverLyricPalette('second')).toEqual(silverBlueLyricPalette())
    cleanup?.()
    h.effect?.()
    lateLoad()
    expect(useCoverLyricPalette('second')).toEqual(silverBlueLyricPalette())
    images[1].onload?.()
    expect(useCoverLyricPalette('second')).not.toEqual(silverBlueLyricPalette())
    expect(images[0].src).toBe('')
    expect(images[0].onload).toBeNull()
    expect(images[0].onerror).toBeNull()
  })

  it('加载失败和移除封面均回退，不残留上一张封面的配色', () => {
    useCoverLyricPalette('cover')
    const cleanup = h.effect?.()
    images[0].onload?.()
    expect(useCoverLyricPalette('cover')).not.toEqual(silverBlueLyricPalette())
    images[0].onerror?.()
    expect(useCoverLyricPalette('cover')).toEqual(silverBlueLyricPalette())
    cleanup?.()
    expect(useCoverLyricPalette()).toEqual(silverBlueLyricPalette())
    expect(h.effect?.()).toBeUndefined()
  })
})
