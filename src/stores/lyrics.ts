import { create } from 'zustand'
import type { LyricLine, LyricLayout } from '../types/domain'

const DEFAULT_LAYOUT: LyricLayout = {
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  offsetZ: 0,
  tiltX: 0,
  tiltY: 0,
  cameraLock: false
}

interface LyricsStore {
  lines: LyricLine[]
  currentIndex: number
  translation: LyricLine[]
  layout: LyricLayout
  desktopLyricsEnabled: boolean
  setLines(lines: LyricLine[], translation?: LyricLine[]): void
  tick(position: number): void
  updateLayout(partial: Partial<LyricLayout>): void
  setDesktopLyricsEnabled(enabled: boolean): void
}

function indexForPosition(lines: LyricLine[], position: number): number {
  let idx = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].time <= position) idx = i
    else break
  }
  return idx
}

export const useLyricsStore = create<LyricsStore>((set, get) => ({
  lines: [],
  currentIndex: -1,
  translation: [],
  layout: { ...DEFAULT_LAYOUT },
  desktopLyricsEnabled: false,

  setLines(lines, translation = []) {
    set({ lines, translation, currentIndex: -1 })
  },

  tick(position) {
    const next = indexForPosition(get().lines, position)
    if (next !== get().currentIndex) set({ currentIndex: next })
  },

  updateLayout(partial) {
    set((s) => ({ layout: { ...s.layout, ...partial } }))
  },

  setDesktopLyricsEnabled(enabled) {
    set({ desktopLyricsEnabled: enabled })
  }
}))
