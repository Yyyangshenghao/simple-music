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
