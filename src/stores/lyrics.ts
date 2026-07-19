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
  /** 罗马音行,已按时间对齐到 lines(与 translation 同构),无数据为空数组 */
  romaji: LyricLine[]
  layout: LyricLayout
  desktopLyricsEnabled: boolean
  wordLines: WordLyricLine[]
  currentCharProgress: number  // 0–1，当前行内逐字进度
  /** 歌词时间偏移(秒),正值=歌词提前(快进)。会话内有效,切歌归零 */
  offsetSec: number
  setLines(lines: LyricLine[], translation?: LyricLine[], romaji?: LyricLine[]): void
  setOffsetSec(v: number): void
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
  romaji: [],
  layout: { ...DEFAULT_LAYOUT },
  desktopLyricsEnabled: false,
  wordLines: [],
  currentCharProgress: 0,
  offsetSec: 0,

  setLines(lines, translation = [], romaji = []) {
    set({ lines, translation, romaji, currentIndex: -1, offsetSec: 0 })
  },

  setOffsetSec(v) {
    set({ offsetSec: Math.max(-10, Math.min(10, Math.round(v * 10) / 10)) })
  },

  tick(position) {
    const { lines, wordLines, currentIndex, offsetSec } = get()
    const adjusted = position + offsetSec
    const next = indexForPosition(lines, adjusted)
    if (next !== currentIndex) set({ currentIndex: next })
    // 更新逐字进度
    if (next >= 0 && next < wordLines.length) {
      const line = wordLines[next]
      const elapsed = (adjusted - line.time) * 1000
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
    const { wordLines, currentIndex, offsetSec } = get()
    if (currentIndex < 0 || currentIndex >= wordLines.length) {
      set({ currentCharProgress: 0 })
      return
    }
    const line = wordLines[currentIndex]
    const elapsed = (position + offsetSec - line.time) * 1000
    const progress = Math.min(1, Math.max(0, elapsed / (line.durationMs || 1)))
    set({ currentCharProgress: progress })
  },
}))
