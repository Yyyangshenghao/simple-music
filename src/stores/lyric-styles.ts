import { useMemo } from 'react'
import { create } from 'zustand'
import { DEFAULT_LYRIC_STYLE, isLyricStyleId, lyricStyleInfo, LYRIC_STYLE_IDS, resolveTuning, sanitizeTuningPatch, type LyricStyleId, type TuningValue } from '../lib/lyric-style-catalog'

export const LYRIC_STYLES_STORAGE_KEY = 'simplemusic-lyric-styles'
const LEGACY_SETTINGS_KEY = 'simplemusic-settings'

type Tunings = Partial<Record<LyricStyleId, Record<string, TuningValue>>>

interface LyricStylesStore {
  /** 「动态」下使用的样式 */
  style: LyricStyleId
  /** 只存用户改过的参数，读取时与默认值合并 */
  tunings: Tunings
  setStyle(id: LyricStyleId): void
  setTuning(id: LyricStyleId, patch: Record<string, TuningValue>): void
  resetTuning(id: LyricStyleId): void
}

function readJson(key: string): unknown {
  try { return JSON.parse(localStorage.getItem(key) ?? 'null') } catch { return null }
}

/** 读档；没有新存档时按旧的歌词页模式迁移（旧版把 3D 当作独立模式）。 */
function load(): Pick<LyricStylesStore, 'style' | 'tunings'> {
  const saved = readJson(LYRIC_STYLES_STORAGE_KEY) as { style?: unknown; tunings?: unknown } | null
  if (!saved || typeof saved !== 'object') {
    const legacy = readJson(LEGACY_SETTINGS_KEY) as { lyricsPanelMode?: unknown } | null
    return { style: legacy?.lyricsPanelMode === '3d' ? 'stage3d' : DEFAULT_LYRIC_STYLE, tunings: {} }
  }
  const tunings: Tunings = {}
  const source = saved.tunings && typeof saved.tunings === 'object' ? saved.tunings as Record<string, unknown> : {}
  for (const id of LYRIC_STYLE_IDS) {
    const values = sanitizeTuningPatch(lyricStyleInfo(id).tuning, source[id])
    if (Object.keys(values).length) tunings[id] = values
  }
  return { style: isLyricStyleId(saved.style) ? saved.style : DEFAULT_LYRIC_STYLE, tunings }
}

function save(state: Pick<LyricStylesStore, 'style' | 'tunings'>): void {
  try { localStorage.setItem(LYRIC_STYLES_STORAGE_KEY, JSON.stringify({ style: state.style, tunings: state.tunings })) } catch { /* 存储不可用时本次会话仍可切换。 */ }
}

export const useLyricStylesStore = create<LyricStylesStore>((set, get) => ({
  ...load(),
  setStyle(id) {
    if (!isLyricStyleId(id) || get().style === id) return
    set({ style: id })
    save(get())
  },
  setTuning(id, patch) {
    const values = sanitizeTuningPatch(lyricStyleInfo(id).tuning, patch)
    if (!Object.keys(values).length) return
    set({ tunings: { ...get().tunings, [id]: { ...get().tunings[id], ...values } } })
    save(get())
  },
  resetTuning(id) {
    const tunings = { ...get().tunings }
    delete tunings[id]
    set({ tunings })
    save(get())
  },
}))

/** 某个样式的完整参数（默认值合并已保存的改动）。 */
export function useLyricStyleTuning(id: LyricStyleId): Record<string, TuningValue> {
  const stored = useLyricStylesStore(state => state.tunings[id])
  // 保持引用稳定：参数对象会进入渲染组件的 effect 依赖。
  return useMemo(() => resolveTuning(lyricStyleInfo(id).tuning, stored), [id, stored])
}
