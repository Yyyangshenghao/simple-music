import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../lib/api'
import type { Track } from '../types/domain'

vi.mock('./player', () => ({ usePlayerStore: { subscribe: () => () => {} } }))

afterEach(() => vi.unstubAllGlobals())

describe('最近播放恢复本地资源', () => {
  it('兼容旧历史的绝对地址，重建当前端口与 token，不改变在线封面或无封面曲目', async () => {
    vi.resetModules()
    vi.stubGlobal('window', { desktop: { serverPort: 40001, serverToken: 'old-token' } })
    const track: Track = { source: 'local', provider: 'local', type: 'local', id: 'a/b', name: 'local', artist: '', artists: [],
      cover: api.url('/api/local/cover', { id: 'a/b' }), url: api.url('/api/local/audio', { id: 'a/b' }) }
    const history = [
      { track, playedAt: 123 },
      { track: { ...track, id: 'no-cover', cover: undefined }, playedAt: 122 },
      { track: { ...track, provider: 'netease', source: 'netease', cover: 'https://cdn.example.com/cover.jpg' }, playedAt: 121 },
    ]
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify(history) })
    vi.stubGlobal('window', { desktop: { serverPort: 40002, serverToken: 'new-token' } })
    const { useRecentPlaysStore } = await import('./recent')
    const items = useRecentPlaysStore.getState().items
    expect(items[0].track.cover).toBe(api.url('/api/local/cover', { id: track.id as string }))
    expect(items[0].track.url).toBe(api.url('/api/local/audio', { id: track.id as string }))
    expect(api.coverImage(items[0].track.cover!)).toBe(items[0].track.cover)
    expect(items[0].playedAt).toBe(123)
    expect(items[1].track.cover).toBeUndefined()
    expect(items[2].track.cover).toBe(history[2].track.cover)
  })
})
