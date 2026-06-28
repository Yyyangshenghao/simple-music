import { create } from 'zustand'
import { useVisualStore } from './visual'
import type { HotkeyBinding } from '../types/ipc'
import type { FxArchive } from '../types/domain'

const STORAGE_KEY = 'mineradio-settings'

interface PersistedSettings {
  hotkeys: HotkeyBinding[]
  shelfShowPodcasts: boolean
  shelfMergeCollections: boolean
  liveBackgroundKeep: boolean
}

interface SettingsStore extends PersistedSettings {
  neteaseLoggedIn: boolean
  qqLoggedIn: boolean
  setHotkeys(hotkeys: HotkeyBinding[]): void
  setNeteaseLoggedIn(v: boolean): void
  setQQLoggedIn(v: boolean): void
  setShelfShowPodcasts(v: boolean): void
  setShelfMergeCollections(v: boolean): void
  setLiveBackgroundKeep(v: boolean): void
  saveToLocal(): void
  loadFromLocal(): void
  exportArchive(name?: string): string
  importArchive(json: string): boolean
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  hotkeys: [],
  neteaseLoggedIn: false,
  qqLoggedIn: false,
  shelfShowPodcasts: true,
  shelfMergeCollections: false,
  liveBackgroundKeep: false,

  setHotkeys(hotkeys) {
    set({ hotkeys })
    get().saveToLocal()
  },
  setNeteaseLoggedIn(v) {
    set({ neteaseLoggedIn: v })
  },
  setQQLoggedIn(v) {
    set({ qqLoggedIn: v })
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

  saveToLocal() {
    if (typeof localStorage === 'undefined') return
    const { hotkeys, shelfShowPodcasts, shelfMergeCollections, liveBackgroundKeep } = get()
    const data: PersistedSettings = { hotkeys, shelfShowPodcasts, shelfMergeCollections, liveBackgroundKeep }
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
        liveBackgroundKeep: data.liveBackgroundKeep ?? false
      })
    } catch {
      /* ignore malformed */
    }
  },

  exportArchive(name = 'Mineradio 存档') {
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
