import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useLyricsStore } from './lyrics'
import { useVisualStore } from './visual'
import { useSettingsStore } from './settings'

describe('lyrics store tick', () => {
  beforeEach(() => {
    useLyricsStore.getState().setLines([
      { time: 0, text: 'a' },
      { time: 2, text: 'b' },
      { time: 4, text: 'c' }
    ])
  })

  it('advances currentIndex by position', () => {
    const { tick } = useLyricsStore.getState()
    tick(0.5)
    expect(useLyricsStore.getState().currentIndex).toBe(0)
    tick(3)
    expect(useLyricsStore.getState().currentIndex).toBe(1)
    tick(10)
    expect(useLyricsStore.getState().currentIndex).toBe(2)
  })

  it('is -1 before first line', () => {
    useLyricsStore.getState().setLines([{ time: 5, text: 'late' }])
    useLyricsStore.getState().tick(1)
    expect(useLyricsStore.getState().currentIndex).toBe(-1)
  })
})

describe('visual archive roundtrip', () => {
  it('save then load restores fx and is archive-shaped', () => {
    useVisualStore.getState().updateFx({ intensity: 0.42, preset: 3 })
    const archive = useVisualStore.getState().saveArchive('test')
    expect(archive.snapshot.intensity).toBe(0.42)
    expect(archive.name).toBe('test')
    useVisualStore.getState().updateFx({ intensity: 0.99 })
    useVisualStore.getState().loadArchive(archive.snapshot)
    expect(useVisualStore.getState().fx.intensity).toBe(0.42)
    expect(useVisualStore.getState().preset).toBe(3)
  })

  it('loadArchive merges missing fields from defaults', () => {
    useVisualStore.getState().loadArchive({ intensity: 0.1 } as never)
    const fx = useVisualStore.getState().fx
    expect(fx.intensity).toBe(0.1)
    expect(typeof fx.speed).toBe('number') // 缺失字段来自默认
  })
})

describe('settings export/import', () => {
  beforeEach(() => {
    const store: Record<string, string> = {}
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v
      }
    })
  })

  it('exports an importable archive', () => {
    useVisualStore.getState().updateFx({ bloomStrength: 0.77 })
    const json = useSettingsStore.getState().exportArchive('x')
    useVisualStore.getState().updateFx({ bloomStrength: 0.1 })
    expect(useSettingsStore.getState().importArchive(json)).toBe(true)
    expect(useVisualStore.getState().fx.bloomStrength).toBe(0.77)
  })

  it('rejects malformed archive', () => {
    expect(useSettingsStore.getState().importArchive('not json')).toBe(false)
  })

  it('persists settings to localStorage', () => {
    useSettingsStore.getState().setLiveBackgroundKeep(true)
    useSettingsStore.setState({ liveBackgroundKeep: false })
    useSettingsStore.getState().loadFromLocal()
    expect(useSettingsStore.getState().liveBackgroundKeep).toBe(true)
  })
})
