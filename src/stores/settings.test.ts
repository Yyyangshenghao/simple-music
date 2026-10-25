import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_LYRICS_3D, SETTINGS_STORAGE_KEY, useSettingsStore, controlMotionFlags } from './settings'
import { defaultShortcuts } from '../lib/shortcuts'

const initialState = useSettingsStore.getState()

describe('页面布局持久化', () => {
  it('左右留白保存后重载保留，切换布局不重置', () => {
    let saved = ''
    vi.stubGlobal('localStorage', { getItem: () => saved, setItem: (_key: string, value: string) => { saved = value } })
    useSettingsStore.getState().setContentGutter(48)
    useSettingsStore.getState().setContentLayout('framed')
    useSettingsStore.setState(initialState, true)
    useSettingsStore.getState().loadFromLocal()
    expect(useSettingsStore.getState().contentGutter).toBe(48)
  })

  it.each([[0, 16], [999, 64], [32.6, 33], [NaN, 24], [Infinity, 24]])('设置留白 %s 限制为 %s', (value, expected) => {
    vi.stubGlobal('localStorage', { setItem: vi.fn() })
    useSettingsStore.getState().setContentGutter(value)
    expect(useSettingsStore.getState().contentGutter).toBe(expected)
  })

  it.each([[undefined, 24], [null, 24], ['48', 24], [-10, 16], [1000, 64]])('存档留白 %s 恢复为 %s', (contentGutter, expected) => {
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify({ contentGutter }) })
    useSettingsStore.getState().loadFromLocal()
    expect(useSettingsStore.getState().contentGutter).toBe(expected)
  })

  it('保存延展布局，重新加载后保留选择', () => {
    let saved = ''
    vi.stubGlobal('localStorage', { getItem: () => saved, setItem: (_key: string, value: string) => { saved = value } })
    useSettingsStore.getState().setContentLayout('full')
    useSettingsStore.setState(initialState, true)
    useSettingsStore.getState().loadFromLocal()
    expect(useSettingsStore.getState().contentLayout).toBe('full')
  })

  it.each([undefined, 'unknown'])('旧存档或无效布局 %s 保留默认边框布局', (contentLayout) => {
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify({ contentLayout }) })
    useSettingsStore.getState().loadFromLocal()
    expect(useSettingsStore.getState().contentLayout).toBe('framed')
  })
})

describe('快捷键设置持久化', () => {
  it.each(['F10', ''])('已配置的设置快捷键 %s 不被升级覆盖', (accelerator) => {
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify({ localHotkeys: [{ action: 'settings', accelerator }] }) })
    useSettingsStore.getState().loadFromLocal()
    expect(useSettingsStore.getState().localHotkeys).toEqual([{ action: 'settings', accelerator }])
  })
  it('升级完整旧默认组合，但保留自定义和主动清除的配置', () => {
    vi.stubGlobal('window', { desktop: { platform: 'darwin' } })
    const oldGlobal = defaultShortcuts('global').filter((item) => item.action !== 'settings' && item.action !== 'game-mode').map((item) => ({ ...item, accelerator: item.action === 'mini-player' ? 'CommandOrControl+Alt+M' : item.accelerator.replace('+Shift', '') }))
    const oldLocal = defaultShortcuts('local').filter((item) => item.action !== 'settings' && item.action !== 'game-mode').map((item) => ({ ...item, accelerator: item.action === 'mini-player' ? 'CommandOrControl+Shift+M' : item.accelerator }))
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
  it('旧版空热键存档补上默认，新增设置入口与游戏模式不恢复其他已清除的绑定', () => {
    const getItem = vi.fn(() => JSON.stringify({ hotkeys: [] }))
    vi.stubGlobal('localStorage', { getItem, setItem: vi.fn() })
    useSettingsStore.getState().loadFromLocal()
    expect(useSettingsStore.getState().hotkeys).toEqual(defaultShortcuts('global'))
    getItem.mockReturnValue(JSON.stringify({ hotkeys: [], localHotkeys: [], globalHotkeysEnabled: false, mediaKeysEnabled: false }))
    useSettingsStore.getState().loadFromLocal()
    expect(useSettingsStore.getState().hotkeys).toEqual([{ action: 'game-mode', accelerator: 'Control+Alt+Shift+G' }])
    expect(useSettingsStore.getState().localHotkeys).toEqual([{ action: 'settings', accelerator: 'Control+,' }])
    expect(useSettingsStore.getState().globalHotkeysEnabled).toBe(false)
    expect(useSettingsStore.getState().mediaKeysEnabled).toBe(false)
  })
  it('旧全局快捷键存档补上游戏模式默认键，主动清除后保留清除', () => {
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify({ localHotkeys: [], hotkeys: [{ action: 'next', accelerator: 'F8' }] }) })
    useSettingsStore.getState().loadFromLocal()
    expect(useSettingsStore.getState().hotkeys).toContainEqual({ action: 'game-mode', accelerator: expect.stringMatching(/\+Alt\+Shift\+G$/) })
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify({ localHotkeys: [], hotkeys: [{ action: 'game-mode', accelerator: '' }] }) })
    useSettingsStore.getState().loadFromLocal()
    expect(useSettingsStore.getState().hotkeys).toEqual([{ action: 'game-mode', accelerator: '' }])
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
  it('默认 120 FPS，旧存档的 60 FPS 保留为省电选择', () => {
    expect(DEFAULT_LYRICS_3D.fpsCap).toBe(120)
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => key === SETTINGS_STORAGE_KEY ? JSON.stringify({ lyrics3d: { fpsCap: 60 } }) : null),
      setItem: vi.fn()
    })
    useSettingsStore.getState().loadFromLocal()
    expect(useSettingsStore.getState().lyrics3d.fpsCap).toBe(60)
  })

  it('有限帧率至少 30 FPS，支持省电档并仍允许不限帧', () => {
    vi.stubGlobal('localStorage', { setItem: vi.fn() })
    useSettingsStore.getState().setLyrics3dParams({ fpsCap: 30 })
    expect(useSettingsStore.getState().lyrics3d.fpsCap).toBe(30)
    useSettingsStore.getState().setLyrics3dParams({ fpsCap: 0 })
    expect(useSettingsStore.getState().lyrics3d.fpsCap).toBe(0)
  })
})

describe('界面动效预设', () => {
  it('简单停用文字显现，极简也停用界面与逐字歌词，标准可恢复', () => {
    vi.stubGlobal('localStorage', { setItem: vi.fn() })
    for (const [preset, ui, textRevealMotion, lyricsWordMotion] of [
      ['simple', true, false, true], ['minimal', false, false, false], ['standard', true, true, true],
    ] as const) {
      useSettingsStore.getState().applyPerformancePreset(preset)
      expect(useSettingsStore.getState().performance).toMatchObject({
        pageTransitionMotion: ui, ...controlMotionFlags(ui), smoothScrollMotion: ui, lyricsLineMotion: ui, textRevealMotion, lyricsWordMotion,
      })
      expect(useSettingsStore.getState().performance).not.toHaveProperty('reduceMotion')
    }
  })
  it.each([true, false])('所有预设都保留独立的减少透明度选择 %s', (reduceTransparency) => {
    vi.stubGlobal('localStorage', { setItem: vi.fn() })
    useSettingsStore.getState().setPerformance({ reduceTransparency })
    for (const preset of ['standard', 'simple', 'minimal'] as const) {
      useSettingsStore.getState().applyPerformancePreset(preset)
      expect(useSettingsStore.getState().performance.reduceTransparency).toBe(reduceTransparency)
    }
  })


})

describe('视觉设置解耦与升级', () => {
  it('旧存档保留视觉表现，新开关独立保存并在重载后恢复', () => {
    let saved = JSON.stringify({ performance: { bgFluidMotion: false, lyrics3dEnabled: false } })
    vi.stubGlobal('localStorage', { getItem: () => saved, setItem: (_key: string, value: string) => { saved = value } })
    useSettingsStore.getState().loadFromLocal()
    expect(useSettingsStore.getState().performance).not.toHaveProperty('lyrics3dEnabled')
    expect(useSettingsStore.getState().performance).toMatchObject({ pageTransitionMotion: true, textRevealMotion: true, lyricsWordMotion: true, bgFluidMotion: false })
    useSettingsStore.getState().setPerformance({ dragMotion: false, textRevealMotion: false, lyricsWordMotion: false })
    useSettingsStore.setState(initialState, true)
    useSettingsStore.getState().loadFromLocal()
    expect(useSettingsStore.getState().performance).toMatchObject({ pageTransitionMotion: true, dragMotion: false, tapFeedbackMotion: true, textRevealMotion: false, lyricsWordMotion: false, bgFluidMotion: false })
  })
  it.each([true, false])('旧「控件动效」为 %s 时七项都继承这个选择，且不再保存旧字段', (controlMotion) => {
    let saved = JSON.stringify({ performance: { controlMotion } })
    vi.stubGlobal('localStorage', { getItem: () => saved, setItem: (_key: string, value: string) => { saved = value } })
    useSettingsStore.getState().loadFromLocal()
    const performance = useSettingsStore.getState().performance
    expect(performance).not.toHaveProperty('controlMotion')
    expect(performance).toMatchObject(controlMotionFlags(controlMotion))
  })
  it.each([true, false])('旧「减少动态效果」为 %s 时拆成四项，其它开关保持原值且不再保存总开关', (reduceMotion) => {
    let saved = JSON.stringify({ performance: { reduceMotion, cardTiltEffect: true, lyricsWordMotion: true } })
    vi.stubGlobal('localStorage', { getItem: () => saved, setItem: (_key: string, value: string) => { saved = value } })
    useSettingsStore.getState().loadFromLocal()
    const performance = useSettingsStore.getState().performance
    expect(performance).not.toHaveProperty('reduceMotion')
    expect(performance).toMatchObject({
      pageTransitionMotion: !reduceMotion, ...controlMotionFlags(!reduceMotion), smoothScrollMotion: !reduceMotion, lyricsLineMotion: !reduceMotion,
      cardTiltEffect: true, lyricsWordMotion: true,
    })
  })
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
  it('恢复默认数值保留旧版底衬兼容值、场景和文字风格', () => {
    const setItem = vi.fn()
    vi.stubGlobal('localStorage', { setItem })
    const settings = useSettingsStore.getState()
    settings.setLyrics3dStyle('storyboard')
    settings.setLyricsOverlayBlur(0.8)
    settings.setLyrics3dParams({ particleCount: 1.7, renderScale: 1.8 })
    settings.resetLyrics3dParams()
    expect(useSettingsStore.getState().lyrics3d).toEqual(DEFAULT_LYRICS_3D)
    expect(useSettingsStore.getState().lyricsOverlayBlur).toBe(0.4)
    expect(useSettingsStore.getState().lyrics3dStyle).toBe('storyboard')
    expect(JSON.parse(setItem.mock.calls.at(-1)![1])).toMatchObject({
      lyrics3d: DEFAULT_LYRICS_3D, lyricsOverlayBlur: 0.4, lyrics3dEffect: 'cover-cloud', lyrics3dStyle: 'storyboard'
    })
  })

  it('旧版跃字 / 3D 迁为动态，未知值回落纯歌词', () => {
    for (const [stored, expected] of [['pop', 'dynamic'], ['3d', 'dynamic'], ['dynamic', 'dynamic'], ['karaoke', 'lyrics']] as const) {
      vi.stubGlobal('localStorage', { getItem: () => JSON.stringify({ lyricsPanelMode: stored }), setItem: vi.fn() })
      useSettingsStore.getState().loadFromLocal()
      expect(useSettingsStore.getState().lyricsPanelMode).toBe(expected)
    }
  })

  it('已移除的场景迁回封面粒子云，分镜风格可从存档读回', () => {
    for (const legacy of ['waveform-3d', 'speaker-particles']) {
      vi.stubGlobal('localStorage', { getItem: () => JSON.stringify({ lyrics3dEffect: legacy, lyrics3dStyle: 'storyboard' }), setItem: vi.fn() })
      useSettingsStore.getState().loadFromLocal()
      expect(useSettingsStore.getState().lyrics3dEffect).toBe('cover-cloud')
      expect(useSettingsStore.getState().lyrics3dStyle).toBe('storyboard')
    }
  })
})


describe('粒光荡漾幅度', () => {
  it.each([0, 1, 6])('迁移旧数量 %s，保留关闭意图，其余使用默认幅度', count => {
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify({ lyrics3d: { rippleCount: count } }), setItem: vi.fn() })
    useSettingsStore.getState().loadFromLocal()
    expect(useSettingsStore.getState().lyrics3d.rippleAmplitude).toBe(count === 0 ? 0 : 0.5)
    expect(useSettingsStore.getState().lyrics3d).not.toHaveProperty('rippleCount')
  })

  it('新幅度优先保留，修改后持久化并约束范围', () => {
    const save = vi.fn()
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify({ lyrics3d: { rippleCount: 0, rippleAmplitude: 0.8 } }), setItem: save })
    useSettingsStore.getState().loadFromLocal()
    expect(useSettingsStore.getState().lyrics3d.rippleAmplitude).toBe(0.8)
    useSettingsStore.getState().setLyrics3dParams({ rippleAmplitude: 2 })
    expect(useSettingsStore.getState().lyrics3d.rippleAmplitude).toBe(1)
    expect(JSON.parse(save.mock.calls.at(-1)![1]).lyrics3d.rippleAmplitude).toBe(1)
  })
})


it('忽略旧版手动线路偏好，保存其他设置时不再写回', () => {
  let saved = JSON.stringify({ lyricsAmllHost: 'gbclstudio', lyricsFontScale: 1.2 })
  vi.stubGlobal('localStorage', { getItem: () => saved, setItem: (_key: string, value: string) => { saved = value } })
  useSettingsStore.getState().loadFromLocal()
  expect(useSettingsStore.getState()).not.toHaveProperty('lyricsAmllHost')
  expect(useSettingsStore.getState().lyricsFontScale).toBe(1.2)
  useSettingsStore.getState().saveToLocal()
  expect(JSON.parse(saved)).not.toHaveProperty('lyricsAmllHost')
  expect(JSON.parse(saved).lyricsFontScale).toBe(1.2)
})
