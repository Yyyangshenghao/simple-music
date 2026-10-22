import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import type { InstalledLyricMod, LyricModCatalog } from '../types/folium'

const mod: InstalledLyricMod = { id: 'cinerama', name: '巨幕', version: '1.0.0', description: '', author: '', preview: '', channel: 'release', compatible: true, digest: 'test', reason: '', valid: true }
const api = { list: vi.fn(async () => [mod]), catalog: vi.fn(async (): Promise<LyricModCatalog> => ({ mods: [mod] })),
  install: vi.fn(async () => {}), remove: vi.fn(async () => {}) }
let storage: Map<string, string>
beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  storage = new Map()
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) })
  vi.stubGlobal('window', { desktop: { lyricMods: api } })
})
afterEach(() => vi.unstubAllGlobals())

describe('模组选择与操作状态', () => {
  it('安装不改变当前选择，使用才持久化，未安装项不能选中', async () => {
    const { useLyricModsStore: store } = await import('./lyric-mods')
    expect(await store.getState().install('cinerama')).toBe(true)
    expect(store.getState().selectedId).toBe(null)
    store.getState().select('missing')
    expect(store.getState().selectedId).toBe(null)
    store.getState().select('cinerama')
    expect(store.getState().selectedId).toBe('cinerama')
    expect(JSON.parse(storage.get('simplemusic-lyric-mods')!).selectedId).toBe('cinerama')
  })
  it('卸载当前样式清理选择与设置；卸载失败保留原选择', async () => {
    const { useLyricModsStore: store } = await import('./lyric-mods')
    await store.getState().refreshInstalled()
    store.getState().select('cinerama')
    store.getState().setValues('cinerama', { size: 1.2 })
    api.remove.mockRejectedValueOnce(new Error('卸载失败'))
    await store.getState().remove('cinerama')
    expect(store.getState().selectedId).toBe('cinerama')
    await store.getState().remove('cinerama')
    expect(store.getState().selectedId).toBe(null)
    expect(store.getState().values.cinerama).toBeUndefined()
  })
  it('旧目录响应不会覆盖较新的刷新，断网仍保留已安装项', async () => {
    const { useLyricModsStore: store } = await import('./lyric-mods')
    let first!: (value: LyricModCatalog) => void
    api.catalog.mockImplementationOnce(() => new Promise(resolve => { first = resolve }))
    const old = store.getState().refreshCatalog()
    await store.getState().refreshCatalog()
    first({ mods: [] })
    await old
    expect(store.getState().catalog).toHaveLength(1)
    await store.getState().refreshInstalled()
    api.catalog.mockRejectedValueOnce(new Error('offline'))
    await store.getState().refreshCatalog()
    expect(store.getState().installed).toHaveLength(1)
    expect(store.getState().error).toBe('offline')
  })
})
