import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchOfflineStatuses, offlineFileUrl, offlineOrigin, offlineTrackKey } from './offline-cache'
import { api } from './api'
import type { Track } from '../types/domain'

const track: Track = {
  provider: 'netease',
  source: 'netease',
  type: 'song',
  id: 123,
  name: '测试歌曲',
  artist: '测试歌手',
  artists: [],
  duration: 180_000,
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('offline-cache', () => {
  it('内容别名 key 不受实际播放来源影响', () => {
    expect(offlineTrackKey(track)).toBe('netease:123')
    expect(offlineOrigin(track)).toMatchObject({ source: 'netease', id: '123', duration: 180_000 })
  })

  it('本地文件地址绑定 entryId 与内容别名', () => {
    vi.stubGlobal('window', { desktop: { serverPort: 35530, serverToken: 'token' } })
    const url = offlineFileUrl({
      source: 'netease',
      id: '123',
      state: 'pinned',
      entryId: 'entry',
      resolved: { source: 'qq', id: 'mid' },
    }, track)
    expect(url).toContain('/api/audio-cache/file')
    expect(url).toContain('entryId=entry')
    expect(url).toContain('source=netease')
    expect(url).toContain('id=123')
    expect(url).toContain('token=token')
  })

  it('状态查询去重、每批最多 100 首，不查询本地音乐', async () => {
    const tracks = Array.from({ length: 205 }, (_, id) => ({ ...track, id }))
    const post = vi.spyOn(api, 'post').mockImplementation(async (_path, body) => {
      const refs = (body as { tracks: Array<{ source: 'netease'; id: string }> }).tracks
      return { statuses: refs.map((ref) => ({ ...ref, state: 'missing' })) }
    })
    const controller = new AbortController()
    const statuses = await fetchOfflineStatuses([
      ...tracks, tracks[0], { ...track, source: 'local', provider: 'local' },
    ], controller.signal)
    expect(statuses).toHaveLength(205)
    expect(post).toHaveBeenCalledTimes(3)
    expect(post.mock.calls.map((call) => (call[1] as { tracks: unknown[] }).tracks.length)).toEqual([100, 100, 5])
    expect(post.mock.calls.every((call) => call[3]?.signal === controller.signal)).toBe(true)
  })
})
