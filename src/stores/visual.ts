import { create } from 'zustand'
import defaultArchive from '../data/default-fx-archive.json'
import type { FxParams, FxSnapshot, FxArchive, PresetId, PerformanceMode, BackgroundMode } from '../types/domain'

const DEFAULT_FX = (defaultArchive as FxArchive).snapshot

interface VisualStore {
  preset: PresetId
  playbackPreset: PresetId
  fx: FxParams
  performanceMode: PerformanceMode
  backgroundMode: BackgroundMode
  setPreset(id: PresetId, opts?: { commitPlayback?: boolean }): void
  updateFx(partial: Partial<FxParams>): void
  setPerformanceMode(mode: PerformanceMode): void
  setBackgroundMode(mode: BackgroundMode): void
  saveArchive(name: string): FxArchive
  loadArchive(snapshot: FxSnapshot): void
}

export const useVisualStore = create<VisualStore>((set, get) => ({
  preset: DEFAULT_FX.preset,
  playbackPreset: DEFAULT_FX.preset,
  fx: { ...DEFAULT_FX },
  performanceMode: 'balanced',
  backgroundMode: 'auto',

  setPreset(id, opts) {
    set((s) => ({
      preset: id,
      playbackPreset: opts?.commitPlayback ? id : s.playbackPreset,
      fx: { ...s.fx, preset: id }
    }))
  },

  updateFx(partial) {
    set((s) => ({ fx: { ...s.fx, ...partial } }))
  },

  setPerformanceMode(mode) {
    set({ performanceMode: mode })
  },

  setBackgroundMode(mode) {
    set({ backgroundMode: mode })
  },

  saveArchive(name) {
    const now = Date.now()
    return {
      type: 'simplemusic-fx-archive',
      schema: (defaultArchive as FxArchive).schema,
      exportedAt: now,
      name,
      savedAt: now,
      snapshot: { ...get().fx }
    }
  },

  loadArchive(snapshot) {
    // 合并到默认值，容忍旧存档缺字段，保证兼容。
    const fx: FxParams = { ...DEFAULT_FX, ...snapshot }
    set({ fx, preset: fx.preset, playbackPreset: fx.preset })
  }
}))
