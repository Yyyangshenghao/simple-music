import { afterEach, expect, it, vi } from 'vitest'
import { SETTINGS_STORAGE_KEY, useSettingsStore } from '../stores/settings'

const initial = useSettingsStore.getState()

afterEach(() => {
  useSettingsStore.setState(initial, true)
  vi.unstubAllGlobals()
})

it('探索模块经后台命令保存并进入重连快照，重新加载存档保留开关与顺序', async () => {
  const storage = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value) },
  })
  vi.stubGlobal('crypto', { randomUUID: () => 'explore-settings-test' })
  const { handlePlaybackRequest, takePlaybackSnapshot } = await import('./playback-host-runtime')
  await handlePlaybackRequest({
    type: 'action', store: 'settings', action: 'setExploreLayout',
    args: ['netease', [{ id: 'listening', enabled: false }, { id: 'featured', enabled: true }]],
  })
  const expected = useSettingsStore.getState().exploreLayouts
  expect(expected.netease.slice(0, 2)).toEqual([{ id: 'listening', enabled: false }, { id: 'featured', enabled: true }])
  expect(takePlaybackSnapshot(true).stores.settings.exploreLayouts).toEqual(expected)
  expect(JSON.parse(storage.get(SETTINGS_STORAGE_KEY)!).exploreLayouts).toEqual(expected)
  useSettingsStore.setState(initial, true)
  useSettingsStore.getState().loadFromLocal()
  expect(useSettingsStore.getState().exploreLayouts).toEqual(expected)
})
