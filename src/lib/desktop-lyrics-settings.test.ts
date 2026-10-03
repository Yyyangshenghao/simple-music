import { afterEach, describe, expect, it, vi } from 'vitest'
import { DESKTOP_LYRICS_STORAGE_KEY, readDesktopLyricsSettings } from './desktop-lyrics-settings'
import { useVisualStore } from '../stores/visual'

const initial = useVisualStore.getState()
afterEach(() => {
  useVisualStore.setState(initial, true)
  vi.unstubAllGlobals()
})

describe('桌面歌词偏好', () => {
  it('保存底框、双行与逐字设置，拒绝无效模式并约束透明度', () => {
    let saved = ''
    vi.stubGlobal('localStorage', { getItem: () => saved, setItem: (_key: string, value: string) => { saved = value } })
    const settings = { desktopLyricsBackgroundOpacity: 0.3, desktopLyricsBackgroundStyle: 'frosted', desktopLyricsLineMode: 'double', desktopLyricsWordByWord: true, desktopLyricsAutoWidth: true } as const
    useVisualStore.getState().updateFx(settings)
    expect(readDesktopLyricsSettings()).toMatchObject(settings)
    saved = JSON.stringify({ desktopLyricsBackgroundOpacity: 2, desktopLyricsBackgroundStyle: 'bad', desktopLyricsLineMode: 'bad', desktopLyricsWordByWord: 'true', desktopLyricsAutoWidth: 'true' })
    expect(readDesktopLyricsSettings()).toEqual({ desktopLyricsBackgroundOpacity: 1 })
    saved = JSON.stringify({ desktopLyricsBackgroundOpacity: 0, desktopLyricsLineMode: 'single', desktopLyricsBackgroundStyle: 'dark', desktopLyricsWordByWord: false, desktopLyricsAutoWidth: false })
    expect(readDesktopLyricsSettings()).toEqual(JSON.parse(saved))
  })
  it('保留旧存档的单字体，新增中文字体可保存并清空', () => {
    let saved = JSON.stringify({ desktopLyricsFontFamily: 'Songti SC' })
    vi.stubGlobal('localStorage', { getItem: () => saved, setItem: (_key: string, value: string) => { saved = value } })
    expect(readDesktopLyricsSettings()).toEqual({ desktopLyricsFontFamily: 'Songti SC' })
    useVisualStore.getState().updateFx({ desktopLyricsFontFamilyCjk: 'Microsoft YaHei' })
    expect(readDesktopLyricsSettings()).toHaveProperty('desktopLyricsFontFamilyCjk', 'Microsoft YaHei')
    useVisualStore.getState().updateFx({ desktopLyricsFontFamilyCjk: '' })
    expect(readDesktopLyricsSettings()).toHaveProperty('desktopLyricsFontFamilyCjk', '')
  })
  it('只保存桌面歌词的开关与外观，不因视觉动画设置变更写入存储', () => {
    let saved = ''
    const setItem = vi.fn((_key: string, value: string) => { saved = value })
    vi.stubGlobal('localStorage', { getItem: () => saved || null, setItem })
    useVisualStore.getState().updateFx({ intensity: 0.42 })
    expect(setItem).not.toHaveBeenCalled()
    useVisualStore.getState().updateFx({ desktopLyrics: true, desktopLyricsSize: 144, desktopLyricsFontFamily: 'Helvetica Neue', desktopLyricsFontFamilyCjk: 'Songti SC', desktopLyricsColor: '#eab308', desktopLyricsOpacity: 0.5, desktopLyricsClickThrough: true, desktopLyricsShowTranslation: false, desktopLyricsShowRoma: true })
    expect(setItem).toHaveBeenCalledWith(DESKTOP_LYRICS_STORAGE_KEY, expect.any(String))
    expect(readDesktopLyricsSettings()).toMatchObject({ desktopLyrics: true, desktopLyricsSize: 144, desktopLyricsFontFamily: 'Helvetica Neue', desktopLyricsFontFamilyCjk: 'Songti SC', desktopLyricsColor: '#eab308', desktopLyricsOpacity: 0.5, desktopLyricsClickThrough: true, desktopLyricsShowTranslation: false })
    expect(saved).not.toContain('intensity')
    expect(readDesktopLyricsSettings()).toHaveProperty('desktopLyricsShowRoma', true)
  })
  it('损坏存档回退，数值约束到可用范围，拒绝错误类型', () => {
    const getItem = vi.fn(() => '{broken')
    vi.stubGlobal('localStorage', { getItem })
    expect(readDesktopLyricsSettings()).toEqual({})
    getItem.mockReturnValue(JSON.stringify({ desktopLyrics: 'true', desktopLyricsOpacity: -1, desktopLyricsSize: 100, desktopLyricsShowTranslation: false }))
    expect(readDesktopLyricsSettings()).toEqual({ desktopLyricsOpacity: 0.28, desktopLyricsSize: 100, desktopLyricsShowTranslation: false })
    getItem.mockReturnValue(JSON.stringify({ desktopLyricsFontFamily: 23, desktopLyricsFontFamilyCjk: 23, desktopLyricsColor: 'url(bad)' }))
    expect(readDesktopLyricsSettings()).toEqual({})
  })
})
