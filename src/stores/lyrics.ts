import { create } from 'zustand'
import type { LyricLine, LyricLayout, WordLyricLine } from '../types/domain'

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
  wordLines: WordLyricLine[]
  currentCharProgress: number  // 0–1，当前行内逐字进度
  setLines(lines: LyricLine[], translation?: LyricLine[]): void
  tick(position: number): void
  updateLayout(partial: Partial<LyricLayout>): void
  setDesktopLyricsEnabled(enabled: boolean): void
  setWordLines(wordLines: WordLyricLine[]): void
  tickProgress(position: number): void
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
  wordLines: [],
  currentCharProgress: 0,

  setLines(lines, translation = []) {
    set({ lines, translation, currentIndex: -1 })
  },

  tick(position) {
    const { lines, wordLines, currentIndex } = get()
    const next = indexForPosition(lines, position)
    if (next !== currentIndex) set({ currentIndex: next })
    // 更新逐字进度
    if (next >= 0 && next < wordLines.length) {
      const line = wordLines[next]
      const elapsed = (position - line.time) * 1000
      const progress = Math.min(1, Math.max(0, elapsed / (line.durationMs || 1)))
      set({ currentCharProgress: progress })
    }
  },

  updateLayout(partial) {
    set((s) => ({ layout: { ...s.layout, ...partial } }))
  },

  setDesktopLyricsEnabled(enabled) {
    set({ desktopLyricsEnabled: enabled })
  },

  setWordLines(wordLines) {
    set({ wordLines })
  },

  tickProgress(position) {
    const { wordLines, currentIndex } = get()
    if (currentIndex < 0 || currentIndex >= wordLines.length) {
      set({ currentCharProgress: 0 })
      return
    }
    const line = wordLines[currentIndex]
    const elapsed = (position - line.time) * 1000
    const progress = Math.min(1, Math.max(0, elapsed / (line.durationMs || 1)))
    set({ currentCharProgress: progress })
  },
}))
