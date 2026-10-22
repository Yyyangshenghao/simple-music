import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'

let storage: Map<string, string>
beforeEach(() => {
  vi.resetModules()
  storage = new Map()
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) })
})
afterEach(() => vi.unstubAllGlobals())

describe('动态歌词样式存档', () => {
  it('默认跃字；切换样式与参数会持久化，非法参数被丢弃', async () => {
    const { useLyricStylesStore: store } = await import('./lyric-styles')
    expect(store.getState().style).toBe('pop')
    store.getState().setStyle('stage3d')
    store.getState().setTuning('pop', { intensity: 1.3, bogus: 1 })
    store.getState().setTuning('pop', { camera: 'no' as never })
    expect(JSON.parse(storage.get('simplemusic-lyric-styles')!)).toEqual({ style: 'stage3d', tunings: { pop: { intensity: 1.3 } } })
    store.getState().resetTuning('pop')
    expect(store.getState().tunings.pop).toBeUndefined()
  })

  it('读档时夹住越界数值、忽略未知样式', async () => {
    storage.set('simplemusic-lyric-styles', JSON.stringify({ style: 'unknown', tunings: { pop: { intensity: 99 }, other: { x: 1 } } }))
    const { useLyricStylesStore: store } = await import('./lyric-styles')
    expect(store.getState().style).toBe('pop')
    expect(store.getState().tunings).toEqual({ pop: { intensity: 1.6 } })
  })

  it('存档选着已撤下的样式：回到跃字；其他样式与撤下样式的旧参数在再保存后都还在', async () => {
    const saved = { style: 'lumiere', tunings: { lumiere: { beams: 1.4 }, tilt: { split: 0.8 }, partita: { step: 1.5 }, pop: { intensity: 1.2 } } }
    storage.set('simplemusic-lyric-styles', JSON.stringify(saved))
    storage.set('simplemusic-settings', JSON.stringify({ lyricsFontScale: 1.2 }))
    const { useLyricStylesStore: store } = await import('./lyric-styles')
    expect(store.getState().style).toBe('pop')
    expect(store.getState().tunings).toEqual({ partita: { step: 1.5 }, pop: { intensity: 1.2 } })
    store.getState().setTuning('pop', { intensity: 1.3 })
    expect(JSON.parse(storage.get('simplemusic-lyric-styles')!)).toEqual({
      style: 'pop',
      tunings: { lumiere: { beams: 1.4 }, tilt: { split: 0.8 }, partita: { step: 1.5 }, pop: { intensity: 1.3 } },
    })
    // 别的存档键不受影响
    expect(JSON.parse(storage.get('simplemusic-settings')!)).toEqual({ lyricsFontScale: 1.2 })
    // 内存里被塞进已撤下的 ID 也不会生效
    store.getState().setStyle('tilt' as never)
    expect(store.getState().style).toBe('pop')
    // 对已撤下 ID 改参数或重置都不写入，存档里保留的旧参数不被覆盖
    store.getState().setTuning('lumiere' as never, { intensity: 1.4 })
    store.getState().resetTuning('tilt' as never)
    expect(JSON.parse(storage.get('simplemusic-lyric-styles')!).tunings.lumiere).toEqual({ beams: 1.4 })
    expect(JSON.parse(storage.get('simplemusic-lyric-styles')!).tunings.tilt).toEqual({ split: 0.8 })
  })

  it.each(['luminous', 'tilt'])('撤下的 %s：存档选着它时回到跃字，旧参数保留，3D 舞台的选择与参数不受影响', async (retired) => {
    storage.set('simplemusic-lyric-styles', JSON.stringify({ style: retired, tunings: { [retired]: { legacy: 1 }, fume: { serif: false } } }))
    const { useLyricStylesStore: store } = await import('./lyric-styles')
    expect(store.getState().style).toBe('pop')
    store.getState().setStyle('stage3d')
    expect(store.getState().style).toBe('stage3d')
    expect(JSON.parse(storage.get('simplemusic-lyric-styles')!)).toEqual({ style: 'stage3d', tunings: { [retired]: { legacy: 1 }, fume: { serif: false } } })
  })

  it('没有新存档时按旧版歌词页模式迁移', async () => {
    storage.set('simplemusic-settings', JSON.stringify({ lyricsPanelMode: '3d' }))
    const { useLyricStylesStore: store } = await import('./lyric-styles')
    expect(store.getState().style).toBe('stage3d')
  })

  it('设置读档把旧 3D 模式迁为动态时保留样式选择', async () => {
    storage.set('simplemusic-settings', JSON.stringify({ lyricsPanelMode: '3d' }))
    const { useSettingsStore } = await import('./settings')
    useSettingsStore.getState().loadFromLocal()
    expect(useSettingsStore.getState().lyricsPanelMode).toBe('dynamic')
    useSettingsStore.getState().saveToLocal()
    const { useLyricStylesStore: store } = await import('./lyric-styles')
    expect(store.getState().style).toBe('stage3d')
  })

  it('旧版 3D 用户迁移时清掉残留的模组选择，跃字用户保留', async () => {
    storage.set('simplemusic-settings', JSON.stringify({ lyricsPanelMode: '3d' }))
    storage.set('simplemusic-lyric-mods', JSON.stringify({ selectedId: 'cinerama', values: { cinerama: { a: 1 } } }))
    const { useSettingsStore } = await import('./settings')
    useSettingsStore.getState().loadFromLocal()
    expect(JSON.parse(storage.get('simplemusic-lyric-mods')!)).toEqual({ selectedId: null, values: { cinerama: { a: 1 } } })
  })

  it('旧版跃字用户的模组选择保持不变', async () => {
    storage.set('simplemusic-settings', JSON.stringify({ lyricsPanelMode: 'pop' }))
    storage.set('simplemusic-lyric-mods', JSON.stringify({ selectedId: 'cinerama', values: {} }))
    const { useSettingsStore } = await import('./settings')
    useSettingsStore.getState().loadFromLocal()
    expect(JSON.parse(storage.get('simplemusic-lyric-mods')!).selectedId).toBe('cinerama')
  })
})
