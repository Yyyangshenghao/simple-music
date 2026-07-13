import { create } from 'zustand'
import { useVisualStore } from './visual'
import type { HotkeyBinding } from '../types/ipc'
import type { FxArchive, Lyrics3dEffect, PlayMode } from '../types/domain'

const STORAGE_KEY = 'simplemusic-settings'

interface PersistedSettings {
  hotkeys: HotkeyBinding[]
  shelfShowPodcasts: boolean
  shelfMergeCollections: boolean
  liveBackgroundKeep: boolean
  lyricsPanelMode: 'lyrics' | '3d'
  lyrics3dEffect: Lyrics3dEffect
  /** 3D 歌词底部叠加层的模糊/背景强度，0=完全透明（无背景），1=最强毛玻璃。 */
  lyricsOverlayBlur: number
  activeSource: 'netease' | 'qq'
  themeMode: 'auto' | 'light' | 'dark'
  audioQuality: 'standard' | 'higher' | 'exhigh' | 'lossless'
  playMode: PlayMode
  /** 自定义字体名称,空字符串表示跟随默认系统字体栈。 */
  fontFamily: string
}

interface SettingsStore extends PersistedSettings {
  neteaseLoggedIn: boolean
  qqLoggedIn: boolean
  neteaseAvatar: string
  neteaseNickname: string
  qqAvatar: string
  qqNickname: string
  setHotkeys(hotkeys: HotkeyBinding[]): void
  setNeteaseLoggedIn(v: boolean): void
  setQQLoggedIn(v: boolean): void
  setNeteaseProfile(avatar: string, nickname: string): void
  setQQProfile(avatar: string, nickname: string): void
  setShelfShowPodcasts(v: boolean): void
  setShelfMergeCollections(v: boolean): void
  setLiveBackgroundKeep(v: boolean): void
  setLyricsPanelMode(mode: 'lyrics' | '3d'): void
  setLyrics3dEffect(effect: Lyrics3dEffect): void
  setLyricsOverlayBlur(v: number): void
  setActiveSource(s: 'netease' | 'qq'): void
  setThemeMode(m: 'auto' | 'light' | 'dark'): void
  setAudioQuality(q: 'standard' | 'higher' | 'exhigh' | 'lossless'): void
  setPlayMode(m: PlayMode): void
  setFontFamily(f: string): void
  saveToLocal(): void
  loadFromLocal(): void
  exportArchive(name?: string): string
  importArchive(json: string): boolean
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  hotkeys: [],
  neteaseLoggedIn: false,
  qqLoggedIn: false,
  neteaseAvatar: '',
  neteaseNickname: '',
  qqAvatar: '',
  qqNickname: '',
  shelfShowPodcasts: true,
  shelfMergeCollections: false,
  liveBackgroundKeep: false,
  lyricsPanelMode: 'lyrics',
  lyrics3dEffect: 'cover-cloud',
  lyricsOverlayBlur: 0.4,
  activeSource: 'netease',
  themeMode: 'auto',
  audioQuality: 'lossless',
  playMode: 'order',
  fontFamily: '',

  setHotkeys(hotkeys) {
    set({ hotkeys })
    get().saveToLocal()
  },
  setNeteaseLoggedIn(v) {
    set(v ? { neteaseLoggedIn: v } : { neteaseLoggedIn: v, neteaseAvatar: '', neteaseNickname: '' })
  },
  setQQLoggedIn(v) {
    set(v ? { qqLoggedIn: v } : { qqLoggedIn: v, qqAvatar: '', qqNickname: '' })
  },
  setNeteaseProfile(avatar, nickname) {
    set({ neteaseAvatar: avatar, neteaseNickname: nickname })
  },
  setQQProfile(avatar, nickname) {
    set({ qqAvatar: avatar, qqNickname: nickname })
  },
  setShelfShowPodcasts(v) {
    set({ shelfShowPodcasts: v })
    get().saveToLocal()
  },
  setShelfMergeCollections(v) {
    set({ shelfMergeCollections: v })
    get().saveToLocal()
  },
  setLiveBackgroundKeep(v) {
    set({ liveBackgroundKeep: v })
    get().saveToLocal()
  },
  setLyricsPanelMode(mode) {
    set({ lyricsPanelMode: mode })
    get().saveToLocal()
  },
  setLyrics3dEffect(effect) {
    set({ lyrics3dEffect: effect })
    get().saveToLocal()
  },
  setLyricsOverlayBlur(v) {
    set({ lyricsOverlayBlur: Math.max(0, Math.min(1, v)) })
    get().saveToLocal()
  },
  setActiveSource(s) {
    set({ activeSource: s })
    get().saveToLocal()
  },
  setThemeMode(m) {
    set({ themeMode: m })
    get().saveToLocal()
  },
  setAudioQuality(q) {
    set({ audioQuality: q })
    get().saveToLocal()
  },
  setPlayMode(m) {
    set({ playMode: m })
    get().saveToLocal()
  },
  setFontFamily(f) {
    set({ fontFamily: f })
    get().saveToLocal()
  },

  saveToLocal() {
    if (typeof localStorage === 'undefined') return
    const { hotkeys, shelfShowPodcasts, shelfMergeCollections, liveBackgroundKeep, lyricsPanelMode, lyrics3dEffect, lyricsOverlayBlur, activeSource, themeMode, audioQuality, playMode, fontFamily } = get()
    const data: PersistedSettings = { hotkeys, shelfShowPodcasts, shelfMergeCollections, liveBackgroundKeep, lyricsPanelMode, lyrics3dEffect, lyricsOverlayBlur, activeSource, themeMode, audioQuality, playMode, fontFamily }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  },

  loadFromLocal() {
    if (typeof localStorage === 'undefined') return
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    try {
      const data = JSON.parse(raw) as Partial<PersistedSettings>
      set({
        hotkeys: data.hotkeys ?? [],
        shelfShowPodcasts: data.shelfShowPodcasts ?? true,
        shelfMergeCollections: data.shelfMergeCollections ?? false,
        liveBackgroundKeep: data.liveBackgroundKeep ?? false,
        lyricsPanelMode: data.lyricsPanelMode ?? 'lyrics',
        lyrics3dEffect: data.lyrics3dEffect ?? 'cover-cloud',
        lyricsOverlayBlur: data.lyricsOverlayBlur ?? 0.4,
        activeSource: data.activeSource ?? 'netease',
        themeMode: data.themeMode ?? 'auto',
        audioQuality: data.audioQuality ?? 'lossless',
        playMode: data.playMode ?? 'order',
        fontFamily: data.fontFamily ?? '',
      })
    } catch {
      /* ignore malformed */
    }
  },

  exportArchive(name = 'SimpleMusic 存档') {
    return JSON.stringify(useVisualStore.getState().saveArchive(name), null, 2)
  },

  importArchive(json) {
    try {
      const archive = JSON.parse(json) as FxArchive
      if (!archive?.snapshot) return false
      useVisualStore.getState().loadArchive(archive.snapshot)
      return true
    } catch {
      return false
    }
  }
}))
