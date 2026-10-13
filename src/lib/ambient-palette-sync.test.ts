import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Track } from '../types/domain'
import { usePlayerStore } from '../stores/player'
import { useAmbientStore } from '../stores/ambient'
import { useNavigationStore } from '../stores/navigation'
import { useGameModeStore } from '../stores/game-mode'
import { api } from './api'

const h = vi.hoisted(() => ({
  palette: vi.fn(() => ['#112233', '#445566', '#778899'] as [string, string, string]),
  luma: vi.fn(() => 0.7)
}))
vi.mock('./extract-color', async importOriginal => ({
  ...await importOriginal<typeof import('./extract-color')>(),
  extractPalette: h.palette, extractLuma: h.luma
}))
import { DEFAULT_PALETTE } from './extract-color'
import { initAmbientPaletteSync } from './ambient-palette-sync'

class TestImage {
  static instances: TestImage[] = []
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  crossOrigin = ''
  src = ''
  constructor() { TestImage.instances.push(this) }
}
const track: Track = { source: 'netease', provider: 'netease', type: 'song', id: 1, name: '封面歌曲', artist: '', artists: [], cover: 'https://p1.music.126.net/first.jpg' }
const initialPlayer = usePlayerStore.getState()
const initialNavigation = useNavigationStore.getState()
let stop: (() => void) | undefined
beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  TestImage.instances = []
  vi.stubGlobal('Image', TestImage)
  usePlayerStore.setState({ ...initialPlayer, currentTrack: track })
  useNavigationStore.setState({ ...initialNavigation, currentView: 'explore' })
  useGameModeStore.setState({ enabled: false })
  useAmbientStore.setState({ palette: [...DEFAULT_PALETTE], coverLuma: 0 })
})
afterEach(() => {
  stop?.()
  stop = undefined
  vi.restoreAllMocks()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('运行时封面取色', () => {
  it('无React也能采样，重复启动、普通切页、进度变化及同封面切歌不重取', () => {
    const coverImage = vi.spyOn(api, 'coverImage')
    stop = initAmbientPaletteSync()
    expect(initAmbientPaletteSync()).toBe(stop)
    expect(coverImage).toHaveBeenCalledWith('https://p1.music.126.net/first.jpg?param=384y384')
    expect(TestImage.instances[0].crossOrigin).toBe('anonymous')
    TestImage.instances[0].onload!()
    expect(useAmbientStore.getState()).toMatchObject({ palette: ['#112233', '#445566', '#778899'], coverLuma: 0.7 })
    useNavigationStore.setState({ currentView: 'library' })
    useNavigationStore.setState({ currentView: 'settings' })
    usePlayerStore.setState({ position: 20, currentTrack: { ...track, id: 2 } })
    expect(TestImage.instances).toHaveLength(1)
    expect(h.palette).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('切歌解除图片回调，旧成功或失败均不能覆盖当前封面', () => {
    stop = initAmbientPaletteSync()
    const image = TestImage.instances[0]
    const oldLoad = image.onload!
    const oldError = image.onerror!
    usePlayerStore.setState({ currentTrack: { ...track, cover: 'https://example.com/new.jpg' } })
    expect(image).toMatchObject({ src: '', onload: null, onerror: null })
    oldLoad()
    expect(h.palette).not.toHaveBeenCalled()
    TestImage.instances[1].onload!()
    oldError()
    expect(useAmbientStore.getState()).toMatchObject({ palette: ['#112233', '#445566', '#778899'], coverLuma: 0.7 })
  })

  it('游戏和刷歌暂停取色，切歌不采样，所有暂停条件解除后只取最新封面', () => {
    stop = initAmbientPaletteSync()
    const oldLoad = TestImage.instances[0].onload!
    useGameModeStore.setState({ enabled: true })
    oldLoad()
    usePlayerStore.setState({ currentTrack: { ...track, cover: 'https://example.com/game.jpg' } })
    useNavigationStore.setState({ currentView: 'shuange' })
    useGameModeStore.setState({ enabled: false })
    expect(TestImage.instances).toHaveLength(1)
    expect(h.palette).not.toHaveBeenCalled()
    useNavigationStore.setState({ currentView: 'explore' })
    expect(TestImage.instances).toHaveLength(2)
    expect(TestImage.instances[1].src).toContain('game.jpg')
    TestImage.instances[1].onload!()
    expect(h.palette).toHaveBeenCalledOnce()
    useNavigationStore.setState({ currentView: 'shuange' })
    useNavigationStore.setState({ currentView: 'library' })
    expect(TestImage.instances).toHaveLength(3)
  })

  it('初始暂停不取图，无封面及当前图片失败回退默认颜色与亮度', () => {
    useGameModeStore.setState({ enabled: true })
    stop = initAmbientPaletteSync()
    expect(TestImage.instances).toHaveLength(0)
    useGameModeStore.setState({ enabled: false })
    TestImage.instances[0].onload!()
    usePlayerStore.setState({ currentTrack: { ...track, cover: undefined } })
    expect(useAmbientStore.getState()).toMatchObject({ palette: DEFAULT_PALETTE, coverLuma: 0 })
    usePlayerStore.setState({ currentTrack: track })
    TestImage.instances[1].onload!()
    TestImage.instances[1].onerror!()
    expect(useAmbientStore.getState()).toMatchObject({ palette: DEFAULT_PALETTE, coverLuma: 0 })
  })

  it('停止幂等，旧回调与后续store变化失效，保留已产出的颜色', () => {
    stop = initAmbientPaletteSync()
    const image = TestImage.instances[0]
    const oldLoad = image.onload!
    const oldError = image.onerror!
    oldLoad()
    stop()
    stop()
    expect(image).toMatchObject({ src: '', onload: null, onerror: null })
    usePlayerStore.setState({ currentTrack: { ...track, cover: 'https://example.com/stopped.jpg' } })
    useNavigationStore.setState({ currentView: 'shuange' })
    useGameModeStore.setState({ enabled: true })
    oldLoad()
    oldError()
    expect(TestImage.instances).toHaveLength(1)
    expect(h.palette).toHaveBeenCalledOnce()
    expect(useAmbientStore.getState()).toMatchObject({ palette: ['#112233', '#445566', '#778899'], coverLuma: 0.7 })
    expect(vi.getTimerCount()).toBe(0)
  })
})
