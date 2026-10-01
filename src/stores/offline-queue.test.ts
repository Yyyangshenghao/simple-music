import { beforeEach, describe, expect, it, vi } from 'vitest'
import { usePlaylistStore } from './playlist'
import { usePlayerStore } from './player'
import { useProviderStore } from './providers'
import { useSettingsStore } from './settings'
import { offlineLibraryTrack } from '../lib/offline-library'

vi.mock('../lib/track-preload', () => ({ preloadTracks: vi.fn() }))

const tracks = (['netease', 'qq'] as const).map((source) => offlineLibraryTrack({
  origin: { source, id: '1', name: `${source} 离线歌曲` },
  entryId: source, savedAt: 1, size: 4, quality: 'standard',
}))

describe('离线库播放队列', () => {
  beforeEach(() => {
    useProviderStore.setState({ byId: {
      netease: { enabled: false, auth: 'anonymous' },
      qq: { enabled: false, auth: 'expired' },
      apple: { enabled: false, auth: 'anonymous' },
    } })
    useSettingsStore.setState({ playMode: 'order' })
    usePlaylistStore.setState({ queue: [], queueIndex: -1, shuffleOrder: [] })
  })
  it('未登录/停用平台时仍进入播放器离线预检，支持上下曲', () => {
    const load = vi.spyOn(usePlayerStore.getState(), 'loadTrack').mockResolvedValue()
    try {
      usePlaylistStore.getState().setQueue(tracks, 0)
      expect(load).toHaveBeenLastCalledWith(tracks[0], { contextId: null })
      usePlaylistStore.getState().next()
      expect(load).toHaveBeenLastCalledWith(tracks[1], { contextId: null })
      usePlaylistStore.getState().prev()
      expect(load).toHaveBeenLastCalledWith(tracks[0], { contextId: null })
    } finally { load.mockRestore() }
  })
  it('Apple 停用时仍不能通过队列触发播放', () => {
    const load = vi.spyOn(usePlayerStore.getState(), 'loadTrack').mockResolvedValue()
    try {
      usePlaylistStore.getState().setQueue([{ ...tracks[0], provider: 'apple', source: 'apple' }], 0)
      expect(load).not.toHaveBeenCalled()
    } finally { load.mockRestore() }
  })
})
