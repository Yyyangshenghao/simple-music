import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useLyricsStore } from './lyrics'
import { useVisualStore } from './visual'
import { useSettingsStore } from './settings'

describe('lyrics store tick', () => {
  beforeEach(() => {
    useLyricsStore.getState().setLines([
      { time: 0, text: 'a' },
      { time: 2, text: 'b' },
      { time: 4, text: 'c' }
    ])
  })

  it('advances currentIndex by position', () => {
    const { tick } = useLyricsStore.getState()
    tick(0.5)
    expect(useLyricsStore.getState().currentIndex).toBe(0)
    tick(3)
    expect(useLyricsStore.getState().currentIndex).toBe(1)
    tick(10)
    expect(useLyricsStore.getState().currentIndex).toBe(2)
  })

  it('is -1 before first line', () => {
    useLyricsStore.getState().setLines([{ time: 5, text: 'late' }])
    useLyricsStore.getState().tick(1)
    expect(useLyricsStore.getState().currentIndex).toBe(-1)
  })
})

describe('visual archive roundtrip', () => {
  it('save then load restores fx and is archive-shaped', () => {
    useVisualStore.getState().updateFx({ intensity: 0.42, preset: 3 })
    const archive = useVisualStore.getState().saveArchive('test')
    expect(archive.snapshot.intensity).toBe(0.42)
    expect(archive.name).toBe('test')
    useVisualStore.getState().updateFx({ intensity: 0.99 })
    useVisualStore.getState().loadArchive(archive.snapshot)
    expect(useVisualStore.getState().fx.intensity).toBe(0.42)
    expect(useVisualStore.getState().preset).toBe(3)
  })

  it('loadArchive merges missing fields from defaults', () => {
    useVisualStore.getState().loadArchive({ intensity: 0.1 } as never)
    const fx = useVisualStore.getState().fx
    expect(fx.intensity).toBe(0.1)
    expect(typeof fx.speed).toBe('number') // 缺失字段来自默认
  })
})

describe('settings export/import', () => {
  beforeEach(() => {
    const store: Record<string, string> = {}
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v
      }
    })
  })

  it('exports an importable archive', () => {
    useVisualStore.getState().updateFx({ bloomStrength: 0.77 })
    const json = useSettingsStore.getState().exportArchive('x')
    useVisualStore.getState().updateFx({ bloomStrength: 0.1 })
    expect(useSettingsStore.getState().importArchive(json)).toBe(true)
    expect(useVisualStore.getState().fx.bloomStrength).toBe(0.77)
  })

  it('rejects malformed archive', () => {
    expect(useSettingsStore.getState().importArchive('not json')).toBe(false)
  })

  it('persists settings to localStorage', () => {
    useSettingsStore.getState().setLiveBackgroundKeep(true)
    useSettingsStore.setState({ liveBackgroundKeep: false })
    useSettingsStore.getState().loadFromLocal()
    expect(useSettingsStore.getState().liveBackgroundKeep).toBe(true)
  })
})

describe('ambient store', () => {
  it('setPalette 更新调色板，resetPalette 回到默认霞光色', async () => {
    const { useAmbientStore } = await import('./ambient')
    const { DEFAULT_PALETTE } = await import('../lib/extract-color')
    expect(useAmbientStore.getState().palette).toEqual(DEFAULT_PALETTE)
    useAmbientStore.getState().setPalette(['#112233', '#445566', '#778899'])
    expect(useAmbientStore.getState().palette).toEqual(['#112233', '#445566', '#778899'])
    useAmbientStore.getState().resetPalette()
    expect(useAmbientStore.getState().palette).toEqual(DEFAULT_PALETTE)
  })
})

describe('navigation store direction', () => {
  it('navigateTo 置 push，goBack 置 pop，空 history 时 goBack 不变', async () => {
    const { useNavigationStore } = await import('./navigation')
    useNavigationStore.setState({ currentView: 'explore', history: [], lastAction: 'push' })
    expect(useNavigationStore.getState().lastAction).toBe('push')
    useNavigationStore.getState().navigateTo('library')
    expect(useNavigationStore.getState().lastAction).toBe('push')
    useNavigationStore.getState().goBack()
    expect(useNavigationStore.getState().lastAction).toBe('pop')
    expect(useNavigationStore.getState().currentView).toBe('explore')
    // history 已空：goBack 无效果，方向不变
    useNavigationStore.getState().navigateTo('settings')
    useNavigationStore.setState({ history: [] })
    useNavigationStore.getState().goBack()
    expect(useNavigationStore.getState().lastAction).toBe('push')
  })
})
