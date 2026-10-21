import { create } from 'zustand'
import type { LyricLine, LyricLayout, WordLyricLine, MusicSource } from '../types/domain'

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
  /** 当前歌词所属曲目；用于异步切歌期间避免新封面短暂配上旧歌词。 */
  trackKey: string | null
  source: MusicSource | null
  loading: boolean
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
  let low = 0
  let high = lines.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (lines[middle].time <= position) low = middle + 1
    else high = middle
  }
  return low - 1
}

function progressForPosition(line: WordLyricLine | undefined, position: number): number {
  if (!line) return 0
  return Math.min(1, Math.max(0, (position - line.time) * 1000 / (line.durationMs || 1)))
}

export const useLyricsStore = create<LyricsStore>((set, get) => ({
  trackKey: null,
  source: null,
  loading: false,
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
    set({ lines, translation, romaji, currentIndex: -1, currentCharProgress: 0, offsetSec: 0 })
  },

  setOffsetSec(v) {
    set({ offsetSec: Math.max(-10, Math.min(10, Math.round(v * 10) / 10)) })
  },

  tick(position) {
    const { lines, wordLines, currentIndex, currentCharProgress, offsetSec } = get()
    const adjusted = position + offsetSec
    const next = indexForPosition(lines, adjusted)
    const progress = progressForPosition(wordLines[next], adjusted)
    if (next !== currentIndex || progress !== currentCharProgress) {
      set({ currentIndex: next, currentCharProgress: progress })
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
    const { wordLines, currentIndex, currentCharProgress, offsetSec } = get()
    const progress = progressForPosition(wordLines[currentIndex], position + offsetSec)
    if (progress !== currentCharProgress) set({ currentCharProgress: progress })
  },
}))
