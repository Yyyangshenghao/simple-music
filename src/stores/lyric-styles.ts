import { useMemo } from 'react'
import { create } from 'zustand'
import { DEFAULT_LYRIC_STYLE, FIXED_LYRIC_TUNING, isLyricStyleId, lyricStyleInfo, LYRIC_STYLE_IDS, RETIRED_LYRIC_STYLE_IDS, resolveStyleTuning, sanitizeTuningPatch, type LyricStyleId, type TuningValue } from '../lib/lyric-style-catalog'

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

/** 已撤下样式在存档里的旧参数：不再使用，但每次保存原样写回，不因撤下而丢失 */
let retiredTunings: Record<string, unknown> = {}
let archivedDetails: Tunings = {}

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
  archivedDetails = {}
  for (const id of LYRIC_STYLE_IDS) {
    const old = source[id] && typeof source[id] === 'object' ? source[id] as Record<string, unknown> : {}
    const archived = Object.fromEntries(Object.keys(FIXED_LYRIC_TUNING[id] ?? {}).filter(key =>
      typeof old[key] === 'boolean' || typeof old[key] === 'string' || (typeof old[key] === 'number' && Number.isFinite(old[key]))
    ).map(key => [key, old[key] as TuningValue]))
    if (Object.keys(archived).length) archivedDetails[id] = archived
    const migrated = id === 'diorama' && old.ambience === undefined && ('dust' in old || 'ripples' in old)
      ? { ...old, ambience: old.dust !== false ? 'full' : old.ripples !== false ? 'water' : 'quiet' } : old
    const values = sanitizeTuningPatch(lyricStyleInfo(id).tuning, migrated)
    if (Object.keys(values).length) tunings[id] = values
  }
  retiredTunings = {}
  for (const id of RETIRED_LYRIC_STYLE_IDS) {
    if (source[id] && typeof source[id] === 'object') retiredTunings[id] = source[id]
  }
  // 存档里选的是已撤下或未知的样式：回到默认样式。
  return { style: isLyricStyleId(saved.style) ? saved.style : DEFAULT_LYRIC_STYLE, tunings }
}

function save(state: Pick<LyricStylesStore, 'style' | 'tunings'>): void {
  const tunings = { ...retiredTunings }
  for (const id of LYRIC_STYLE_IDS) {
    if (archivedDetails[id] || state.tunings[id]) tunings[id] = { ...archivedDetails[id], ...state.tunings[id] }
  }
  try { localStorage.setItem(LYRIC_STYLES_STORAGE_KEY, JSON.stringify({ style: state.style, tunings })) } catch { /* 存储不可用时本次会话仍可切换。 */ }
}

export const useLyricStylesStore = create<LyricStylesStore>((set, get) => ({
  ...load(),
  setStyle(id) {
    if (!isLyricStyleId(id) || get().style === id) return
    set({ style: id })
    save(get())
  },
  setTuning(id, patch) {
    // 已撤下或未知的 ID 不写入：否则会按默认样式的字段清洗后覆盖存档里保留的旧参数。
    if (!isLyricStyleId(id)) return
    const values = sanitizeTuningPatch(lyricStyleInfo(id).tuning, patch)
    if (!Object.keys(values).length) return
    set({ tunings: { ...get().tunings, [id]: { ...get().tunings[id], ...values } } })
    save(get())
  },
  resetTuning(id) {
    if (!isLyricStyleId(id)) return
    const tunings = { ...get().tunings }
    delete tunings[id]
    delete archivedDetails[id]
    set({ tunings })
    save(get())
  },
}))

/** 某个样式的完整参数（默认值合并已保存的改动）。 */
export function useLyricStyleTuning(id: LyricStyleId): Record<string, TuningValue> {
  const stored = useLyricStylesStore(state => state.tunings[id])
  // 保持引用稳定：参数对象会进入渲染组件的 effect 依赖。
  return useMemo(() => resolveStyleTuning(id, stored), [id, stored])
}
