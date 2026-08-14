import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Track } from '../types/domain'

const apiGet = vi.fn()
vi.mock('./api', () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args),
  },
}))

import { fetchTrackQualities } from './track-qualities'

beforeEach(() => {
  apiGet.mockReset()
})

describe('fetchTrackQualities', () => {
  it('QQ 曲目使用 mediaMid 探测真实音频文件档位', async () => {
    apiGet.mockResolvedValue({ qualities: [] })
    const track = {
      provider: 'qq',
      source: 'qq',
      type: 'qq',
      id: 'song-mid',
      mid: 'song-mid',
      mediaMid: 'file-mid',
      name: '测试歌曲',
      artist: '测试歌手',
      artists: [],
    } as Track

    await fetchTrackQualities(track)

    expect(apiGet).toHaveBeenCalledWith('/api/qq/song/qualities', {
      mid: 'song-mid',
      mediaMid: 'file-mid',
    }, { timeoutMs: 60_000 })
  })
})
