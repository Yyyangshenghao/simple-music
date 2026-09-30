import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_LYRICS_3D, SETTINGS_STORAGE_KEY, useSettingsStore } from './settings'

const initialState = useSettingsStore.getState()

afterEach(() => {
  useSettingsStore.setState(initialState, true)
  vi.unstubAllGlobals()
})

describe('3D 歌词帧率', () => {
  it('默认 120 FPS，旧存档的 60 FPS 加载后提升到 120', () => {
    expect(DEFAULT_LYRICS_3D.fpsCap).toBe(120)
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => key === SETTINGS_STORAGE_KEY ? JSON.stringify({ lyrics3d: { fpsCap: 60 } }) : null),
      setItem: vi.fn()
    })
    useSettingsStore.getState().loadFromLocal()
    expect(useSettingsStore.getState().lyrics3d.fpsCap).toBe(120)
  })

  it('有限帧率至少 120 FPS，仍允许不限帧', () => {
    vi.stubGlobal('localStorage', { setItem: vi.fn() })
    useSettingsStore.getState().setLyrics3dParams({ fpsCap: 30 })
    expect(useSettingsStore.getState().lyrics3d.fpsCap).toBe(120)
    useSettingsStore.getState().setLyrics3dParams({ fpsCap: 0 })
    expect(useSettingsStore.getState().lyrics3d.fpsCap).toBe(0)
  })
})

describe('界面动效预设', () => {
  it('切换预设不会改变 3D 歌词总开关', () => {
    vi.stubGlobal('localStorage', { setItem: vi.fn() })
    useSettingsStore.getState().setPerformance({ lyrics3dEnabled: false })
    useSettingsStore.getState().applyPerformancePreset('standard')
    expect(useSettingsStore.getState().performance.lyrics3dEnabled).toBe(false)

    useSettingsStore.getState().setPerformance({ lyrics3dEnabled: true })
    useSettingsStore.getState().applyPerformancePreset('minimal')
    expect(useSettingsStore.getState().performance.lyrics3dEnabled).toBe(true)
  })
})
