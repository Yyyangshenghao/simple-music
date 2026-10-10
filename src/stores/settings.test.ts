import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_LYRICS_3D, SETTINGS_STORAGE_KEY, useSettingsStore } from './settings'
import { defaultShortcuts } from '../lib/shortcuts'

const initialState = useSettingsStore.getState()

describe('快捷键设置持久化', () => {
  it.each(['F10', ''])('已配置的设置快捷键 %s 不被升级覆盖', (accelerator) => {
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify({ localHotkeys: [{ action: 'settings', accelerator }] }) })
    useSettingsStore.getState().loadFromLocal()
    expect(useSettingsStore.getState().localHotkeys).toEqual([{ action: 'settings', accelerator }])
  })
  it('升级完整旧默认组合，但保留自定义和主动清除的配置', () => {
    vi.stubGlobal('window', { desktop: { platform: 'darwin' } })
    const oldGlobal = defaultShortcuts('global').filter((item) => item.action !== 'settings').map((item) => ({ ...item, accelerator: item.action === 'mini-player' ? 'CommandOrControl+Alt+M' : item.accelerator.replace('+Shift', '') }))
    const oldLocal = defaultShortcuts('local').filter((item) => item.action !== 'settings').map((item) => ({ ...item, accelerator: item.action === 'mini-player' ? 'CommandOrControl+Shift+M' : item.accelerator }))
    const getItem = vi.fn(() => JSON.stringify({ hotkeys: oldGlobal, localHotkeys: oldLocal }))
    vi.stubGlobal('localStorage', { getItem })
    useSettingsStore.getState().loadFromLocal()
    expect(useSettingsStore.getState().hotkeys.find((item) => item.action === 'mini-player')?.accelerator).toBe('Command+Alt+Shift+P')
    expect(useSettingsStore.getState().localHotkeys.find((item) => item.action === 'mini-player')?.accelerator).toBe('Command+Shift+P')
    const custom = oldGlobal.map((item) => item.action === 'next' ? { ...item, accelerator: 'F9' } : item)
    getItem.mockReturnValue(JSON.stringify({ hotkeys: custom, localHotkeys: [] }))
    useSettingsStore.getState().loadFromLocal()
    expect(useSettingsStore.getState().hotkeys.find((item) => item.action === 'next')?.accelerator).toBe('F9')
    expect(useSettingsStore.getState().hotkeys.find((item) => item.action === 'mini-player')?.accelerator).toBe('Command+Alt+M')
    expect(useSettingsStore.getState().localHotkeys).toEqual([{ action: 'settings', accelerator: 'Command+,' }])
  })
  it('旧版空热键存档补上默认，新增设置入口不恢复其他已清除的绑定', () => {
    const getItem = vi.fn(() => JSON.stringify({ hotkeys: [] }))
    vi.stubGlobal('localStorage', { getItem, setItem: vi.fn() })
    useSettingsStore.getState().loadFromLocal()
    expect(useSettingsStore.getState().hotkeys).toEqual(defaultShortcuts('global'))
    getItem.mockReturnValue(JSON.stringify({ hotkeys: [], localHotkeys: [], globalHotkeysEnabled: false, mediaKeysEnabled: false }))
    useSettingsStore.getState().loadFromLocal()
    expect(useSettingsStore.getState().hotkeys).toEqual([])
    expect(useSettingsStore.getState().localHotkeys).toEqual([{ action: 'settings', accelerator: 'Control+,' }])
    expect(useSettingsStore.getState().globalHotkeysEnabled).toBe(false)
    expect(useSettingsStore.getState().mediaKeysEnabled).toBe(false)
  })
  it('编辑、清除与开关跨重启保留，恢复默认不改变其他设置', () => {
    let saved = ''
    vi.stubGlobal('localStorage', { getItem: () => saved, setItem: (_key: string, value: string) => { saved = value } })
    const settings = useSettingsStore.getState()
    settings.setLocalHotkeys([{ action: 'next', accelerator: 'F8' }, { action: 'prev', accelerator: '' }])
    settings.setGlobalHotkeysEnabled(false)
    settings.setMediaKeysEnabled(false)
    useSettingsStore.setState(initialState, true)
    useSettingsStore.getState().loadFromLocal()
    expect(useSettingsStore.getState().localHotkeys).toEqual([{ action: 'next', accelerator: 'F8' }, { action: 'prev', accelerator: '' }, { action: 'settings', accelerator: 'Control+,' }])
    expect(useSettingsStore.getState().mediaKeysEnabled).toBe(false)
    useSettingsStore.getState().setThemeMode('light')
    useSettingsStore.getState().resetShortcuts()
    expect(useSettingsStore.getState().localHotkeys).toEqual(defaultShortcuts('local'))
    expect(useSettingsStore.getState().themeMode).toBe('light')
  })
})

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
  it.each([true, false])('所有预设都保留独立的减少透明度选择 %s', (reduceTransparency) => {
    vi.stubGlobal('localStorage', { setItem: vi.fn() })
    useSettingsStore.getState().setPerformance({ reduceTransparency })
    for (const preset of ['standard', 'simple', 'minimal'] as const) {
      useSettingsStore.getState().applyPerformancePreset(preset)
      expect(useSettingsStore.getState().performance.reduceTransparency).toBe(reduceTransparency)
    }
  })

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

describe('视觉设置解耦与升级', () => {
  it.each([true, false])('旧组合开关为 %s 时，新选项继承原选择，废弃火花不再保存', (enabled) => {
    let saved = JSON.stringify({ performance: { cardTiltEffect: enabled, bgFluidMotion: enabled, clickSparkEffect: true } })
    vi.stubGlobal('localStorage', { getItem: () => saved, setItem: (_key: string, value: string) => { saved = value } })
    useSettingsStore.getState().loadFromLocal()
    expect(useSettingsStore.getState().performance).toMatchObject({
      cardTiltEffect: enabled, cardSpotlightEffect: enabled, bgFluidMotion: enabled, bgPointerMotion: enabled
    })
    useSettingsStore.getState().saveToLocal()
    expect(JSON.parse(saved).performance).not.toHaveProperty('clickSparkEffect')
  })

  it('光斑与倾斜、跟随与流动各自保存，重载后不会重新捆绑', () => {
    let saved = ''
    vi.stubGlobal('localStorage', { getItem: () => saved, setItem: (_key: string, value: string) => { saved = value } })
    useSettingsStore.getState().setPerformance({ cardTiltEffect: false, cardSpotlightEffect: true, bgFluidMotion: true, bgPointerMotion: false })
    useSettingsStore.setState(initialState, true)
    useSettingsStore.getState().loadFromLocal()
    expect(useSettingsStore.getState().performance).toMatchObject({
      cardTiltEffect: false, cardSpotlightEffect: true, bgFluidMotion: true, bgPointerMotion: false
    })
  })
})

describe('3D 歌词数值恢复', () => {
  it('恢复默认数值也恢复简洁叠层模糊，并保留场景和文字风格', () => {
    const setItem = vi.fn()
    vi.stubGlobal('localStorage', { setItem })
    const settings = useSettingsStore.getState()
    settings.setLyrics3dEffect('waveform-3d')
    settings.setLyrics3dStyle('focus')
    settings.setLyricsOverlayBlur(0.8)
    settings.setLyrics3dParams({ particleCount: 1.7, renderScale: 1.8 })
    settings.resetLyrics3dParams()
    expect(useSettingsStore.getState().lyrics3d).toEqual(DEFAULT_LYRICS_3D)
    expect(useSettingsStore.getState().lyricsOverlayBlur).toBe(0.4)
    expect(useSettingsStore.getState().lyrics3dEffect).toBe('waveform-3d')
    expect(useSettingsStore.getState().lyrics3dStyle).toBe('focus')
    expect(JSON.parse(setItem.mock.calls.at(-1)![1])).toMatchObject({
      lyrics3d: DEFAULT_LYRICS_3D, lyricsOverlayBlur: 0.4, lyrics3dEffect: 'waveform-3d', lyrics3dStyle: 'focus'
    })
  })
})
