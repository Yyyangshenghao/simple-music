import { afterEach, expect, it, vi } from 'vitest'
import { useSettingsStore } from '../stores/settings'
import { handlePlaybackRequest, takePlaybackSnapshot } from './playback-host-runtime'

const initial = useSettingsStore.getState()
afterEach(() => { useSettingsStore.setState(initial, true); vi.unstubAllGlobals() })

it('页面布局经真实宿主命令通路保存，重连快照保留选择', async () => {
  const save = vi.fn()
  vi.stubGlobal('localStorage', { setItem: save })
  await handlePlaybackRequest({ type: 'action', store: 'settings', action: 'setContentLayout', args: ['full'] })
  expect(useSettingsStore.getState().contentLayout).toBe('full')
  expect(save).toHaveBeenCalledWith('simplemusic-settings', expect.stringContaining('"contentLayout":"full"'))
  expect(takePlaybackSnapshot(true).stores.settings.contentLayout).toBe('full')
})

it('左右留白经宿主命令限制范围、保存并同步到重连快照', async () => {
  const save = vi.fn()
  vi.stubGlobal('localStorage', { setItem: save })
  await handlePlaybackRequest({ type: 'action', store: 'settings', action: 'setContentGutter', args: [999] })
  expect(useSettingsStore.getState().contentGutter).toBe(64)
  expect(save).toHaveBeenCalledWith('simplemusic-settings', expect.stringContaining('"contentGutter":64'))
  expect(takePlaybackSnapshot(true).stores.settings.contentGutter).toBe(64)
})

it('歌词播放控制样式经宿主保存，完整快照与重新读取存档保留选择', async () => {
  const storage = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  })
  await handlePlaybackRequest({ type: 'action', store: 'settings', action: 'setLyricsPlayerStyle', args: ['dock'] })
  expect(takePlaybackSnapshot(true).stores.settings.lyricsPlayerStyle).toBe('dock')
  useSettingsStore.setState({ lyricsPlayerStyle: 'stage' })
  useSettingsStore.getState().loadFromLocal()
  expect(useSettingsStore.getState().lyricsPlayerStyle).toBe('dock')
})
