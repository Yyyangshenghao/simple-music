import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePlaylistStore } from '../stores/playlist'
import { usePlayerStore } from '../stores/player'
import { useProviderStore } from '../stores/providers'
import { appendDiscoveredTrack } from './queue-discovery'
import type { Track } from '../types/domain'

const seed: Track = { provider: 'qq', source: 'qq', type: 'qq', id: 'seed', name: '原曲', artist: '', artists: [] }
const next = { ...seed, id: 'next', name: '新曲' }

describe('appendDiscoveredTrack', () => {
  beforeEach(() => {
    useProviderStore.setState((s) => ({ byId: { ...s.byId, qq: { enabled: true, auth: 'authenticated' } } }))
    usePlaylistStore.setState({ queue: [seed], queueIndex: 0, queueContextId: 'original', shuffleOrder: [0] })
    usePlayerStore.setState({ currentTrack: seed, position: 42, status: 'playing' })
  })
  afterEach(() => vi.restoreAllMocks())

  it('只追加，不改变当前曲目、播放位置、语境或原随机顺序', () => {
    const loadTrack = vi.spyOn(usePlayerStore.getState(), 'loadTrack')
    expect(appendDiscoveredTrack(next)).toBe(true)
    expect(usePlaylistStore.getState()).toMatchObject({ queue: [seed, next], queueIndex: 0,
      queueContextId: 'original', shuffleOrder: [0, 1] })
    expect(usePlayerStore.getState()).toMatchObject({ currentTrack: seed, position: 42, status: 'playing' })
    expect(loadTrack).not.toHaveBeenCalled()
  })
  it('重复点击不重复加入，但不同来源相同 ID 不误判', () => {
    usePlaylistStore.setState({ queue: [{ ...next, source: 'netease' }] })
    expect(appendDiscoveredTrack(next)).toBe(true)
    expect(appendDiscoveredTrack(next)).toBe(false)
    expect(usePlaylistStore.getState().queue).toHaveLength(2)
  })
  it('QQ 被禁用或登录失效后不追加旧推荐', () => {
    for (const qq of [{ enabled: false, auth: 'authenticated' as const }, { enabled: true, auth: 'expired' as const }]) {
      useProviderStore.setState((s) => ({ byId: { ...s.byId, qq } }))
      expect(appendDiscoveredTrack(next)).toBe(false)
    }
    expect(usePlaylistStore.getState().queue).toEqual([seed])
  })
})
