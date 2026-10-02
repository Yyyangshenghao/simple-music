import type { FxParams } from '../types/domain'
import { DESKTOP_LYRICS_MAX_SIZE } from './desktop-lyrics-layout'

export const DESKTOP_LYRICS_STORAGE_KEY = 'simplemusic-desktop-lyrics'
const BOOLEAN_KEYS = ['desktopLyrics', 'desktopLyricsClickThrough', 'desktopLyricsHighlight', 'desktopLyricsShowTranslation', 'desktopLyricsShowRoma'] as const
const NUMBER_LIMITS = { desktopLyricsSize: [12, DESKTOP_LYRICS_MAX_SIZE], desktopLyricsOpacity: [0.28, 1] } as const
const STRING_KEYS = ['desktopLyricsFontFamily', 'desktopLyricsColor'] as const
type DesktopLyricsSettings = Pick<FxParams, (typeof BOOLEAN_KEYS)[number] | keyof typeof NUMBER_LIMITS | (typeof STRING_KEYS)[number]>

/** 只保留桌面歌词偏好，避免改变视觉场景和存档的加载行为。 */
export function readDesktopLyricsSettings(): Partial<DesktopLyricsSettings> {
  try {
    if (typeof localStorage === 'undefined') return {}
    const data = JSON.parse(localStorage.getItem(DESKTOP_LYRICS_STORAGE_KEY) ?? '{}')
    if (!data || typeof data !== 'object') return {}
    const settings: Partial<DesktopLyricsSettings> = {}
    for (const key of BOOLEAN_KEYS) {
      if (typeof data[key] === 'boolean') settings[key] = data[key]
    }
    for (const key of Object.keys(NUMBER_LIMITS) as (keyof typeof NUMBER_LIMITS)[]) {
      const value = data[key]
      if (typeof value === 'number' && Number.isFinite(value)) {
        const [min, max] = NUMBER_LIMITS[key]
        settings[key] = Math.max(min, Math.min(max, value))
      }
    }
    if (typeof data.desktopLyricsFontFamily === 'string') settings.desktopLyricsFontFamily = data.desktopLyricsFontFamily
    if (typeof data.desktopLyricsColor === 'string' && /^#[\da-f]{6}$/i.test(data.desktopLyricsColor)) settings.desktopLyricsColor = data.desktopLyricsColor
    return settings
  } catch {
    return {}
  }
}

export function saveDesktopLyricsSettings(fx: FxParams, changed: Partial<FxParams>): void {
  if (![...BOOLEAN_KEYS, ...Object.keys(NUMBER_LIMITS), ...STRING_KEYS].some((key) => Object.hasOwn(changed, key))) return
  try {
    if (typeof localStorage === 'undefined') return
    const data = Object.fromEntries([...BOOLEAN_KEYS, ...Object.keys(NUMBER_LIMITS), ...STRING_KEYS].map((key) => [key, fx[key as keyof FxParams]]))
    localStorage.setItem(DESKTOP_LYRICS_STORAGE_KEY, JSON.stringify(data))
  } catch {
    /* 存储不可用时仍允许当前会话使用桌面歌词。 */
  }
}
