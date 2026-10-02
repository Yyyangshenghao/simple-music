import { afterEach, describe, expect, it, vi } from 'vitest'
import { DESKTOP_LYRICS_STORAGE_KEY, readDesktopLyricsSettings } from './desktop-lyrics-settings'
import { useVisualStore } from '../stores/visual'

const initial = useVisualStore.getState()
afterEach(() => {
  useVisualStore.setState(initial, true)
  vi.unstubAllGlobals()
})

describe('桌面歌词偏好', () => {
  it('只保存桌面歌词的开关与外观，不因视觉动画设置变更写入存储', () => {
    let saved = ''
    const setItem = vi.fn((_key: string, value: string) => { saved = value })
    vi.stubGlobal('localStorage', { getItem: () => saved || null, setItem })
    useVisualStore.getState().updateFx({ intensity: 0.42 })
    expect(setItem).not.toHaveBeenCalled()
    useVisualStore.getState().updateFx({ desktopLyrics: true, desktopLyricsSize: 144, desktopLyricsFontFamily: 'Songti SC', desktopLyricsColor: '#eab308', desktopLyricsOpacity: 0.5, desktopLyricsClickThrough: true, desktopLyricsShowTranslation: false, desktopLyricsShowRoma: true })
    expect(setItem).toHaveBeenCalledWith(DESKTOP_LYRICS_STORAGE_KEY, expect.any(String))
    expect(readDesktopLyricsSettings()).toMatchObject({ desktopLyrics: true, desktopLyricsSize: 144, desktopLyricsFontFamily: 'Songti SC', desktopLyricsColor: '#eab308', desktopLyricsOpacity: 0.5, desktopLyricsClickThrough: true, desktopLyricsShowTranslation: false })
    expect(saved).not.toContain('intensity')
    expect(readDesktopLyricsSettings()).toHaveProperty('desktopLyricsShowRoma', true)
  })
  it('损坏存档回退，数值约束到可用范围，拒绝错误类型', () => {
    const getItem = vi.fn(() => '{broken')
    vi.stubGlobal('localStorage', { getItem })
    expect(readDesktopLyricsSettings()).toEqual({})
    getItem.mockReturnValue(JSON.stringify({ desktopLyrics: 'true', desktopLyricsOpacity: -1, desktopLyricsSize: 100, desktopLyricsShowTranslation: false }))
    expect(readDesktopLyricsSettings()).toEqual({ desktopLyricsOpacity: 0.28, desktopLyricsSize: 100, desktopLyricsShowTranslation: false })
    getItem.mockReturnValue(JSON.stringify({ desktopLyricsFontFamily: 23, desktopLyricsColor: 'url(bad)' }))
    expect(readDesktopLyricsSettings()).toEqual({})
  })
})
