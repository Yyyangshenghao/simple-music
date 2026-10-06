import { beforeEach, describe, expect, it, vi } from 'vitest'
import { usePlaylistStore } from './playlist'
import { usePlayerStore } from './player'
import { useProviderStore } from './providers'
import type { Track } from '../types/domain'

const track: Track = { provider: 'netease', source: 'netease', type: 'song', id: 1, name: 'A', artist: '', artists: [] }
describe('批量追加队列', () => {
  beforeEach(() => {
    useProviderStore.setState((state) => ({ byId: { ...state.byId, netease: { enabled: true, auth: 'authenticated' }, qq: { enabled: true, auth: 'authenticated' } } }))
    usePlaylistStore.setState({ queue: [track, { ...track, id: 2 }], queueIndex: 1, queueContextId: 'album', shuffleOrder: [1, 0] })
  })
  it('一次追加，保留当前播放及原随机顺序，复合 ID 去重', () => {
    const load = vi.spyOn(usePlayerStore.getState(), 'loadTrack')
    expect(usePlaylistStore.getState().addManyToQueue([track, { ...track, id: 3 }, { ...track, id: 3 }, { ...track, provider: 'qq', source: 'qq' }])).toBe(2)
    expect(usePlaylistStore.getState()).toMatchObject({ queueIndex: 1, queueContextId: 'album', shuffleOrder: [1, 0, 2, 3] })
    expect(usePlaylistStore.getState().queue.map((item) => `${item.source}:${String(item.id)}`)).toEqual(['netease:1', 'netease:2', 'netease:3', 'qq:1'])
    expect(load).not.toHaveBeenCalled()
    load.mockRestore()
  })
  it('不可播或失效平台的曲目不入队，本地仍可追加', () => {
    useProviderStore.setState((state) => ({ byId: { ...state.byId, qq: { enabled: false, auth: 'authenticated' } } }))
    expect(usePlaylistStore.getState().addManyToQueue([{ ...track, id: 3, playable: false }, { ...track, provider: 'qq', source: 'qq' }, { ...track, provider: 'local', source: 'local' }])).toBe(1)
    expect(usePlaylistStore.getState().queue.at(-1)?.source).toBe('local')
  })
  it('离线网易/QQ 在未登录或禁用平台时仍可追加，Apple 与不可播歌曲仍受限制', () => {
    useProviderStore.setState((state) => ({ byId: { ...state.byId,
      netease: { enabled: false, auth: 'anonymous' }, qq: { enabled: true, auth: 'expired' }, apple: { enabled: false, auth: 'anonymous' },
    } }))
    const incoming: Track[] = [{ ...track, id: 3 }, { ...track, provider: 'qq', source: 'qq' }, { ...track, provider: 'apple', source: 'apple' }, { ...track, id: 4, playable: false }]
    expect(usePlaylistStore.getState().addManyToQueue(incoming)).toBe(0)
    expect(usePlaylistStore.getState().addManyToQueue(incoming, true)).toBe(2)
    expect(usePlaylistStore.getState()).toMatchObject({ queueIndex: 1, queueContextId: 'album', shuffleOrder: [1, 0, 2, 3] })
    expect(usePlaylistStore.getState().queue.map(item => `${item.source}:${String(item.id)}`)).toEqual(['netease:1', 'netease:2', 'netease:3', 'qq:1'])
  })
})
