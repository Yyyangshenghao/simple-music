import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Track } from '../types/domain'

const apiGet = vi.fn()
vi.mock('./api', () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args),
  },
}))

import { clearTrackQualityCache, fetchTrackQualities, loadTrackQualities, peekTrackQualities } from './track-qualities'
import { advanceProviderAccountSession } from './provider-account-session'

beforeEach(() => {
  apiGet.mockReset()
  clearTrackQualityCache()
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

describe('loadTrackQualities', () => {
  const track = { provider: 'netease', source: 'netease', type: 'song', id: 42, name: '歌', artist: '人', artists: [] } as unknown as Track

  it('同曲并发合并为一次请求，成功后可同步读到缓存', async () => {
    apiGet.mockResolvedValue({ qualities: [{ level: 'lossless', label: '无损' }] })
    expect(peekTrackQualities(track)).toBeUndefined()
    const [a, b] = await Promise.all([loadTrackQualities(track), loadTrackQualities(track)])
    expect(apiGet).toHaveBeenCalledOnce()
    expect(a).toBe(b)
    expect(peekTrackQualities(track)).toEqual([{ level: 'lossless', label: '无损' }])
    await loadTrackQualities(track)
    expect(apiGet).toHaveBeenCalledOnce()
  })

  it('失败不缓存，切换账号后重新探测', async () => {
    apiGet.mockRejectedValueOnce(new Error('timeout')).mockResolvedValue({ qualities: [] })
    await expect(loadTrackQualities(track)).rejects.toThrow('timeout')
    expect(peekTrackQualities(track)).toBeUndefined()
    await loadTrackQualities(track)
    expect(peekTrackQualities(track)).toEqual([])
    advanceProviderAccountSession('netease')
    expect(peekTrackQualities(track)).toBeUndefined()
    await loadTrackQualities(track)
    expect(apiGet).toHaveBeenCalledTimes(3)
  })

  it('本地与 Apple Music 不缓存也不请求', async () => {
    const local = { ...track, source: 'local', provider: 'local' } as Track
    expect(await loadTrackQualities(local)).toEqual([])
    expect(peekTrackQualities(local)).toBeUndefined()
    expect(apiGet).not.toHaveBeenCalled()
  })
})
