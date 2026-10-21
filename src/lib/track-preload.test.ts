import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Track } from '../types/domain'
import { advanceProviderAccountSession } from './provider-account-session'

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
  releasePreloadWindow,
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
  vi.restoreAllMocks()
})

describe('preloadTracks / getPreloadedUrl', () => {
  it('独立宿主保留地址预热但不创建封面图片', async () => {
    const image = vi.fn()
    vi.stubGlobal('Image', image)
    vi.stubGlobal('window', { desktop: { playbackRole: 'host' } })
    apiGet.mockResolvedValue({ url: 'https://cdn/host.mp3' })
    const track = makeTrack('host', { cover: 'https://cover/host' })
    preloadTracks([track], 'standard', null, { owner: 'shuange', coverPx: 768 })
    await flush()
    expect(image).not.toHaveBeenCalled()
    expect(getPreloadedUrl(track, 'standard')).toBe('https://cdn/host.mp3')
  })

  it('歌词页封面窗口独立保留 释放时只清自己的图片', () => {
    const images: Array<{ src: string }> = []
    vi.stubGlobal('Image', function (this: { src: string }) { images.push(this) })
    const current = makeTrack('cur', { cover: 'https://p1.music.126.net/cur.jpg' })
    const next = makeTrack('next', { cover: 'https://p1.music.126.net/next.jpg' })
    preloadTracks([next], 'standard', current, { owner: 'lyrics', coverPx: 840, deferUrls: true })
    preloadTracks([], 'standard', null, { owner: 'shuange' })
    expect(images.map(img => img.src)).toEqual([
      'https://p1.music.126.net/cur.jpg?param=840y840',
      'https://p1.music.126.net/next.jpg?param=840y840',
    ])
    expect(apiGet).not.toHaveBeenCalled()
    releasePreloadWindow('lyrics')
    expect(images.every(img => img.src === '')).toBe(true)
  })

  it('普通播放与刷歌预热互相保留缓存且同曲在途请求只发一次', async () => {
    apiGet.mockResolvedValue({ url: 'http://cdn/shared.mp3' })
    const playerTrack = makeTrack('player')
    const shuangeTrack = makeTrack('shuange')
    preloadTracks([playerTrack], 'standard')
    preloadTracks([shuangeTrack], 'standard', null, { owner: 'shuange' })
    await flush()
    expect(getPreloadedUrl(playerTrack, 'standard')).toBe('http://cdn/shared.mp3')
    expect(getPreloadedUrl(shuangeTrack, 'standard')).toBe('http://cdn/shared.mp3')
    preloadTracks([playerTrack, shuangeTrack], 'standard')
    await flush()
    expect(apiGet).toHaveBeenCalledTimes(2)
  })

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
  it('播放器从预热坏地址回退到普通解析时允许重新查询', async () => {
    apiGet.mockResolvedValueOnce({ url: 'http://cdn/broken.mp3' }).mockResolvedValueOnce({ url: 'http://cdn/recovered.mp3' })
    const track = makeTrack('recovery')
    preloadTracks([track], 'standard', null, { owner: 'shuange' })
    await flush()
    expect(getPreloadedResolution(track, 'standard')?.url).toBe('http://cdn/broken.mp3')
    expect((await resolveSongUrl(track, 'standard')).url).toBe('http://cdn/recovered.mp3')
    expect(apiGet).toHaveBeenCalledTimes(2)
  })

  it('预热地址过期后只重新解析一次 当前播放复用更新后的地址', async () => {
    let now = 1_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    apiGet.mockResolvedValueOnce({ url: 'http://cdn/old.mp3' }).mockResolvedValueOnce({ url: 'http://cdn/fresh.mp3' })
    const track = makeTrack('expiry')
    preloadTracks([track], 'standard', null, { owner: 'shuange' })
    await flush()
    now += 6 * 60_000
    preloadTracks([track], 'standard', null, { owner: 'shuange' })
    const result = await resolveSongUrl(track, 'standard')
    expect(result.url).toBe('http://cdn/fresh.mp3')
    expect(apiGet).toHaveBeenCalledTimes(2)
  })

  it('新账号不命中旧账号的地址或在途请求', async () => {
    let finishOld!: (value: { url: string }) => void
    apiGet.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve }))
      .mockResolvedValueOnce({ url: 'http://cdn/new-account.mp3' })
    const track = makeTrack('account')
    preloadTracks([track], 'standard', null, { owner: 'shuange' })
    advanceProviderAccountSession('netease')
    preloadTracks([track], 'standard', null, { owner: 'shuange' })
    await flush()
    finishOld({ url: 'http://cdn/old-account.mp3' })
    await flush()
    expect(getPreloadedUrl(track, 'standard')).toBe('http://cdn/new-account.mp3')
    expect(apiGet).toHaveBeenCalledTimes(2)
  })

  it('最后一个消费者取消后不复用已中止的请求', async () => {
    let finishOld!: (value: { url: string }) => void
    apiGet.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve }))
      .mockResolvedValueOnce({ url: 'http://cdn/retry.mp3' })
    const track = makeTrack('abort')
    const controller = new AbortController()
    const first = resolveSongUrl(track, 'standard', controller.signal)
    const failed = expect(first).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    expect(apiGet.mock.calls[0][2].signal.aborted).toBe(true)
    const second = resolveSongUrl(track, 'standard')
    finishOld({ url: 'http://cdn/stale.mp3' })
    await failed
    await expect(second).resolves.toMatchObject({ url: 'http://cdn/retry.mp3' })
    expect(apiGet).toHaveBeenCalledTimes(2)
  })

  it('Apple和本地文件不进入在线直链预热', async () => {
    preloadTracks([makeTrack('apple', { source: 'apple' }), makeTrack('local', { source: 'local' })], 'standard', null, { owner: 'shuange' })
    await flush()
    expect(apiGet).not.toHaveBeenCalled()
  })

  it('QQ 曲目把音频文件 mediaMid 传给播放地址接口', async () => {
    apiGet.mockResolvedValue({ url: 'http://cdn/qq.mp3' })
    await resolveSongUrl(makeTrack('song-mid', {
      provider: 'qq',
      source: 'qq',
      mid: 'song-mid',
      mediaMid: 'file-mid',
      fee: 0,
    }), 'standard')
    expect(apiGet).toHaveBeenCalledWith('/api/qq/song/url', {
      mid: 'song-mid',
      mediaMid: 'file-mid',
      quality: 'standard',
      fee: '0',
    }, { signal: expect.any(AbortSignal) })
  })

  it('把 AbortSignal 透传给底层请求(切歌时可中止在途 fetch)', async () => {
    apiGet.mockResolvedValue({ url: 'http://cdn/1.mp3' })
    const ac = new AbortController()
    await resolveSongUrl(makeTrack('1'), 'standard', ac.signal)
    expect(apiGet).toHaveBeenCalledWith('/api/song/url', { id: '1', quality: 'standard' }, { signal: expect.any(AbortSignal) })
  })

  it('无外部 signal 时使用共享请求自己的取消信号', async () => {
    apiGet.mockResolvedValue({ url: 'http://cdn/1.mp3' })
    await resolveSongUrl(makeTrack('1'), 'standard')
    expect(apiGet).toHaveBeenCalledWith('/api/song/url', { id: '1', quality: 'standard' }, { signal: expect.any(AbortSignal) })
  })

  it('实际播放加入预热请求后释放预热窗口不会取消播放查询', async () => {
    let finish!: (value: { url: string }) => void
    apiGet.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const track = makeTrack('shared')
    preloadTracks([track], 'standard', null, { owner: 'shuange' })
    const playing = resolveSongUrl(track, 'standard')
    const signal = apiGet.mock.calls[0][2].signal as AbortSignal
    preloadTracks([], 'standard', null, { owner: 'shuange' })
    expect(signal.aborted).toBe(false)
    finish({ url: 'http://cdn/shared.mp3' })
    await expect(playing).resolves.toMatchObject({ url: 'http://cdn/shared.mp3' })
    expect(apiGet).toHaveBeenCalledOnce()
  })
})
