import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Track } from '../types/domain'

const apiGet = vi.fn()
vi.mock('./api', () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args),
    url: (path: string) => path
  }
}))

import { preloadTracks, getPreloadedUrl, clearPreloadCaches } from './track-preload'

function makeTrack(id: string, extra: Partial<Track> = {}): Track {
  return {
    provider: 'netease',
    source: 'netease',
    type: 'song',
    id,
    name: `t${id}`,
    artist: 'a',
    artists: [],
    ...extra
  } as Track
}

async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0))
}

beforeEach(() => {
  clearPreloadCaches()
  apiGet.mockReset()
})

describe('preloadTracks / getPreloadedUrl', () => {
  it('解析并缓存播放 URL,命中后不再重复请求', async () => {
    apiGet.mockResolvedValue({ url: 'http://cdn/1.mp3' })
    const t1 = makeTrack('1')
    preloadTracks([t1], 'standard')
    await flush()
    expect(getPreloadedUrl(t1, 'standard')).toBe('http://cdn/1.mp3')

    preloadTracks([t1], 'standard')
    await flush()
    expect(apiGet).toHaveBeenCalledTimes(1)
  })

  it('URL 按音质分键,过期后返回 undefined 并清除', async () => {
    apiGet.mockResolvedValue({ url: 'http://cdn/1.mp3' })
    const t1 = makeTrack('1')
    preloadTracks([t1], 'standard')
    await flush()
    expect(getPreloadedUrl(t1, 'lossless')).toBeUndefined()
    const afterTtl = Date.now() + 6 * 60 * 1000
    expect(getPreloadedUrl(t1, 'standard', afterTtl)).toBeUndefined()
    expect(getPreloadedUrl(t1, 'standard')).toBeUndefined()
  })

  it('新批次清掉出窗口的旧条目(保留当前曲目)', async () => {
    apiGet.mockResolvedValue({ url: 'http://cdn/x.mp3' })
    const t1 = makeTrack('1')
    const t2 = makeTrack('2')
    const t3 = makeTrack('3')
    preloadTracks([t1, t2], 'standard')
    await flush()
    // 窗口滑动:当前 t2,邻居 t1/t3 → t2 虽不在 tracks 里也要保留
    preloadTracks([t1, t3], 'standard', t2)
    await flush()
    expect(getPreloadedUrl(t1, 'standard')).toBe('http://cdn/x.mp3')
    // t2 不在本批 tracks 中未重新解析,但之前的缓存不能被清
    expect(getPreloadedUrl(t2, 'standard')).toBe('http://cdn/x.mp3')
  })

  it('在途请求晚到且已滑出窗口时丢弃结果', async () => {
    let resolve1!: (v: { url: string }) => void
    apiGet
      .mockImplementationOnce(() => new Promise((r) => (resolve1 = r)))
      .mockResolvedValue({ url: 'http://cdn/2.mp3' })
    const t1 = makeTrack('1')
    const t2 = makeTrack('2')
    preloadTracks([t1], 'standard')
    preloadTracks([t2], 'standard')
    resolve1({ url: 'http://cdn/1.mp3' })
    await flush()
    expect(getPreloadedUrl(t1, 'standard')).toBeUndefined()
    expect(getPreloadedUrl(t2, 'standard')).toBe('http://cdn/2.mp3')
  })

  it('pending 占位与自带直链的曲目不发解析请求', async () => {
    const pendingTrack = makeTrack('1', { pending: true })
    const directTrack = makeTrack('2', { url: 'http://cdn/direct.mp3' })
    preloadTracks([pendingTrack, directTrack], 'standard')
    await flush()
    expect(apiGet).not.toHaveBeenCalled()
  })

  it('解析失败静默,不缓存任何东西', async () => {
    apiGet.mockRejectedValue(new Error('boom'))
    const t1 = makeTrack('1')
    preloadTracks([t1], 'standard')
    await flush()
    expect(getPreloadedUrl(t1, 'standard')).toBeUndefined()
  })
})
