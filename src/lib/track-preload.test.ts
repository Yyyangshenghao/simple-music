import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Track } from '../types/domain'

const apiGet = vi.fn()
vi.mock('./api', () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args),
    url: (path: string) => path
  }
}))

import {
  preloadTracks,
  getPreloadedUrl,
  getPreloadedResolution,
  audioDiskCacheKey,
  resolveSongUrl,
  clearPreloadCaches,
} from './track-preload'

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

afterEach(() => {
  clearPreloadCaches()
  vi.unstubAllGlobals()
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

  it('窗口滑动时会中止已经滑出的 URL 预取', async () => {
    let staleSignal: AbortSignal | undefined
    apiGet
      .mockImplementationOnce((_path, _params, init?: { signal?: AbortSignal }) => new Promise((_resolve, reject) => {
        staleSignal = init?.signal
        staleSignal?.addEventListener('abort', () => reject(new Error('aborted')))
      }))
      .mockResolvedValueOnce({ url: 'http://cdn/2.mp3' })

    preloadTracks([makeTrack('1')], 'standard')
    preloadTracks([makeTrack('2')], 'standard')
    await flush()

    expect(staleSignal?.aborted).toBe(true)
  })

  it('按界面实际尺寸预载封面，并主动释放滑出窗口的图片引用', () => {
    const images: Array<{ src: string }> = []
    class FakeImage {
      decoding = 'auto'
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      private value = ''
      constructor() { images.push(this) }
      get src() { return this.value }
      set src(value: string) { this.value = value }
    }
    vi.stubGlobal('Image', FakeImage)
    const first = makeTrack('1', { cover: 'https://p.music.126.net/first.jpg', url: 'direct:1' })
    const second = makeTrack('2', { cover: 'https://p.music.126.net/second.jpg', url: 'direct:2' })

    preloadTracks([first], 'standard', null, { coverPx: 768 })
    expect(images[0].src).toContain('param=768y768')

    preloadTracks([second], 'standard', null, { coverPx: 768 })
    expect(images[0].src).toBe('')
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

describe('audioDiskCacheKey', () => {
  it('按实际交付 level 分键(而非请求档),降级不占高档 key', () => {
    const t = makeTrack('123')
    // 请求母带但上游降级为无损:key 落在 lossless,与真正的母带 key 区分开
    expect(audioDiskCacheKey(t, 'lossless')).toBe('netease:123:lossless')
    expect(audioDiskCacheKey(t, 'jymaster')).toBe('netease:123:jymaster')
    expect(audioDiskCacheKey(t, 'lossless')).not.toBe(audioDiskCacheKey(t, 'jymaster'))
  })

  it('QQ 曲目用 mid 组键', () => {
    const q = makeTrack('0', { source: 'qq', mid: 'abc' } as Partial<Track>)
    expect(audioDiskCacheKey(q, 'exhigh')).toBe('qq:abc:exhigh')
  })
})

describe('getPreloadedResolution', () => {
  it('透出预解析的 level 与 trial(供 loadTrack 决定缓存 key 与是否落盘)', async () => {
    apiGet.mockResolvedValue({ url: 'http://cdn/1.mp3', quality: '无损', level: 'lossless', trial: false })
    const t1 = makeTrack('1')
    preloadTracks([t1], 'lossless')
    await flush()
    expect(getPreloadedResolution(t1, 'lossless')).toEqual({
      url: 'http://cdn/1.mp3',
      quality: '无损',
      level: 'lossless',
      trial: false,
    })
  })

  it('试听片段的 trial 标记被保留', async () => {
    apiGet.mockResolvedValue({ url: 'http://cdn/trial.mp3', level: 'standard', trial: true })
    const t1 = makeTrack('1')
    preloadTracks([t1], 'standard')
    await flush()
    expect(getPreloadedResolution(t1, 'standard')?.trial).toBe(true)
  })
})

describe('resolveSongUrl', () => {
  it('把 AbortSignal 透传给底层请求(切歌时可中止在途 fetch)', async () => {
    apiGet.mockResolvedValue({ url: 'http://cdn/1.mp3' })
    const ac = new AbortController()
    await resolveSongUrl(makeTrack('1'), 'standard', ac.signal)
    expect(apiGet).toHaveBeenCalledWith('/api/song/url', { id: '1', quality: 'standard' }, { signal: ac.signal })
  })

  it('无 signal 时不带 init', async () => {
    apiGet.mockResolvedValue({ url: 'http://cdn/1.mp3' })
    await resolveSongUrl(makeTrack('1'), 'standard')
    expect(apiGet).toHaveBeenCalledWith('/api/song/url', { id: '1', quality: 'standard' }, undefined)
  })
})
