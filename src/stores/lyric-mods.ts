import { create } from 'zustand'
import type { InstalledLyricMod, LyricMod, ModSetting } from '../types/folium'

const STORAGE = 'simplemusic-lyric-mods'
const validId = (id: unknown): id is string => typeof id === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(id)
interface Preferences { selectedId: string | null; values: Record<string, Record<string, unknown>> }
function preferences(): Preferences {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE) ?? '{}')
    return { selectedId: validId(value.selectedId) ? value.selectedId : null,
      values: Object.fromEntries(Object.entries(value.values ?? {}).filter(([id, values]) => validId(id) && values && typeof values === 'object' && !Array.isArray(values)).slice(0, 20)) as Preferences['values'] }
  } catch { return { selectedId: null, values: {} } }
}
interface LyricModsStore extends Preferences {
  installed: InstalledLyricMod[]
  catalog: LyricMod[]
  loaded: boolean
  loading: boolean
  busy: string | null
  error: string
  schemas: Record<string, ModSetting[]>
  refreshInstalled(): Promise<void>
  refreshCatalog(): Promise<void>
  install(id: string): Promise<boolean>
  remove(id: string): Promise<void>
  select(id: string | null): void
  setValues(id: string, patch: Record<string, unknown>): void
  setSchema(id: string, schema: ModSetting[]): void
}
let listRevision = 0
let catalogRevision = 0
function save(value: Preferences): void {
  try { localStorage.setItem(STORAGE, JSON.stringify({ selectedId: value.selectedId, values: value.values })) } catch { /* Rendering remains usable if preference storage is unavailable. */ }
}
const message = (error: unknown) => error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : '模组操作失败，请重试'

export const useLyricModsStore = create<LyricModsStore>((set, get) => ({
  ...preferences(), installed: [], catalog: [], loaded: false, loading: false, busy: null, error: '', schemas: {},
  async refreshInstalled() {
    // 浏览器预览等没有桌面桥的环境里没有模组，保持内置样式。
    if (!window.desktop?.lyricMods) return
    const revision = ++listRevision
    try {
      const installed = await window.desktop.lyricMods.list()
      if (revision === listRevision) set({ installed, loaded: true })
    } catch (error) { if (revision === listRevision) set({ error: message(error), loaded: true }) }
  },
  async refreshCatalog() {
    const revision = ++catalogRevision
    set({ loading: true, error: '' })
    try {
      const result = await window.desktop.lyricMods.catalog()
      if (revision === catalogRevision) set({ catalog: result.mods })
    } catch (error) { if (revision === catalogRevision) set({ error: message(error) }) }
    finally { if (revision === catalogRevision) set({ loading: false }) }
  },
  async install(id) {
    if (!validId(id) || get().busy) return false
    ++listRevision
    set({ busy: id, error: '' })
    try {
      await window.desktop.lyricMods.install(id)
      await get().refreshInstalled()
      return true
    } catch (error) { set({ error: message(error) }); return false }
    finally { set({ busy: null }) }
  },
  async remove(id) {
    if (!validId(id) || get().busy) return
    ++listRevision
    set({ busy: id, error: '' })
    try {
      await window.desktop.lyricMods.remove(id)
      if (get().selectedId === id) get().select(null)
      const values = { ...get().values }
      delete values[id]
      set({ values })
      save(get())
      await get().refreshInstalled()
    } catch (error) { set({ error: message(error) }) }
    finally { set({ busy: null }) }
  },
  select(id) {
    if (id !== null && !get().installed.some(mod => mod.id === id && mod.valid)) return
    set({ selectedId: id })
    save(get())
  },
  setValues(id, patch) {
    if (!validId(id)) return
    const values = { ...get().values, [id]: { ...get().values[id], ...patch } }
    set({ values })
    save(get())
  },
  setSchema(id, schema) { set({ schemas: { ...get().schemas, [id]: schema } }) }
}))
