import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Track } from '../types/domain'

const apiGet = vi.fn()
vi.mock('./api', () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args),
  },
}))

import { QQMusicService } from './qq-music-service'

beforeEach(() => {
  apiGet.mockReset()
})

describe('QQMusicService.getLyrics', () => {
  it('只把真实 qqId 作为歌词接口的数字 id', async () => {
    apiGet.mockResolvedValue({ lines: [] })
    const track = {
      provider: 'qq',
      source: 'qq',
      type: 'qq',
      id: '003a1B2c',
      qqId: 123456,
      mid: '003a1B2c',
      name: '测试歌曲',
      artist: '测试歌手',
      artists: [],
    } as Track

    await new QQMusicService().getLyrics(track)

    expect(apiGet).toHaveBeenCalledWith('/api/qq/lyric', {
      id: 123456,
      mid: '003a1B2c',
    })
  })
})
