import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Track } from '../types/domain'
import { useProviderStore } from '../stores/providers'
import { useSettingsStore } from '../stores/settings'
import { matchedBilibiliTrack, useBilibiliCoverStore } from '../stores/bilibili-covers'
import { advanceProviderAccountSession } from './provider-account-session'
import { clearBilibiliSongIdentityCache, findBilibiliLyricMatch, resolveBilibiliSongIdentity } from './bilibili-song-identity'

const h = vi.hoisted(() => ({ netease: vi.fn(), qq: vi.fn(), apple: vi.fn(), qishui: vi.fn() }))
vi.mock('../providers/registry', () => ({ providerFor: (source: 'netease' | 'qq' | 'apple' | 'qishui') => ({ catalog: { searchTracks: h[source] } }) }))
vi.mock('./api', () => ({ api: { get: vi.fn() } }))

const video: Track = {
  id: 'BV1BZbSzZEGT', bvid: 'BV1BZbSzZEGT', source: 'bilibili', provider: 'bilibili', type: 'song',
  name: '【Hi-Res】周杰伦《晴天》', videoTitle: '【Hi-Res】周杰伦《晴天》',
  artist: '上传账号', artists: [], uploader: '上传账号', duration: 269_000,
}
const song = (source: 'netease' | 'qq', extra: Partial<Track> = {}): Track => ({
  id: source === 'qq' ? 'qmid' : 186016, mid: source === 'qq' ? 'qmid' : undefined,
  source, provider: source, type: 'song', name: '晴天', artist: '周杰伦',
  artists: [{ id: 6452, name: '周杰伦' }], duration: 269_000, cover: 'https://example.com/album.jpg', ...extra,
})
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

beforeEach(() => {
  clearBilibiliSongIdentityCache()
  useBilibiliCoverStore.setState({ entries: {} })
  vi.resetAllMocks()
  useSettingsStore.setState({ lyricsPlatformSources: { netease: true, qq: true, apple: false, qishui: false }, lyricsGuestSources: { netease: false, qq: false } })
  useProviderStore.setState({ byId: {
    ...useProviderStore.getState().byId,
    netease: { enabled: true, auth: 'authenticated' }, qq: { enabled: true, auth: 'authenticated' },
    apple: { enabled: false, auth: 'anonymous' }, qishui: { enabled: false, auth: 'anonymous' },
  } })
  h.netease.mockResolvedValue([song('netease')])
  h.qq.mockResolvedValue([song('qq')])
})

describe('B 站统一歌曲识别', () => {
  it('封面、平台原生歌词和 AMLL 映射共用一次识别，同平台直接复用 ID', async () => {
    const [identity, native, amll] = await Promise.all([
      resolveBilibiliSongIdentity(video), findBilibiliLyricMatch(video, 'netease'), findBilibiliLyricMatch(video, 'netease'),
    ])
    expect(identity?.track.id).toBe(186016)
    expect(native).toBe(identity)
    expect(amll).toBe(identity)
    expect(h.netease.mock.calls).toEqual([['晴天 周杰伦']])
    expect(h.qq).not.toHaveBeenCalled()
    expect(matchedBilibiliTrack(video)).toMatchObject({ id: 186016, name: '晴天', artist: '周杰伦' })
    await resolveBilibiliSongIdentity({ ...video, url: 'https://example.com/temporary', cover: 'changed' })
    expect(h.netease).toHaveBeenCalledOnce()
    expect(video.name).toBe('【Hi-Res】周杰伦《晴天》')
  })

  it('其他平台按已识别身份映射，并发查询同平台不会再重复搜索', async () => {
    const results = await Promise.all([findBilibiliLyricMatch(video, 'qq'), findBilibiliLyricMatch(video, 'qq')])
    expect(results[0]?.track.id).toBe('qmid')
    expect(h.netease).toHaveBeenCalledOnce()
    expect(h.qq.mock.calls).toEqual([['晴天 周杰伦']])
  })

  it('多读法每个平台最多两次搜索，空结果短期复用', async () => {
    h.netease.mockResolvedValue([])
    h.qq.mockResolvedValue([])
    const ambiguous = { ...video, name: '周杰伦 - 晴天', videoTitle: '周杰伦 - 晴天' }
    expect(await resolveBilibiliSongIdentity(ambiguous)).toBeNull()
    expect(await resolveBilibiliSongIdentity(ambiguous)).toBeNull()
    expect(h.netease.mock.calls).toEqual([['周杰伦 晴天'], ['晴天 周杰伦']])
    expect(h.qq).toHaveBeenCalledTimes(2)
  })

  it('首个平台未命中再查下一个平台；歧义结果不靠换平台掩盖', async () => {
    h.netease.mockResolvedValue([])
    expect((await resolveBilibiliSongIdentity(video))?.track.source).toBe('qq')
    clearBilibiliSongIdentityCache()
    useBilibiliCoverStore.setState({ entries: {} })
    h.netease.mockResolvedValue([song('netease'), song('netease', { id: 'other', name: '周杰伦', artist: '晴天', artists: [{ id: 2, name: '晴天' }] })])
    h.qq.mockClear()
    await expect(findBilibiliLyricMatch({ ...video, videoTitle: '周杰伦 - 晴天' }, 'netease', undefined, true)).rejects.toThrow('TRACK_VERSION_MISMATCH')
    expect(h.qq).not.toHaveBeenCalled()
  })

  it('一个调用者取消不影响其他调用者，全部取消后迟到结果不入缓存', async () => {
    const upstream = deferred<Track[]>()
    h.netease.mockReturnValue(upstream.promise)
    const first = new AbortController()
    const second = new AbortController()
    const cancelled = resolveBilibiliSongIdentity(video, first.signal)
    const retained = resolveBilibiliSongIdentity(video, second.signal)
    first.abort()
    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' })
    upstream.resolve([song('netease')])
    expect((await retained)?.track.id).toBe(186016)
    expect(h.netease).toHaveBeenCalledOnce()

    clearBilibiliSongIdentityCache()
    useBilibiliCoverStore.setState({ entries: {} })
    const late = deferred<Track[]>()
    h.netease.mockReturnValue(late.promise)
    const controller = new AbortController()
    const pending = resolveBilibiliSongIdentity(video, controller.signal)
    await vi.waitFor(() => expect(h.netease).toHaveBeenCalledTimes(2))
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    late.resolve([song('netease')])
    await Promise.resolve()
    expect(matchedBilibiliTrack(video)).toBeUndefined()
    h.netease.mockResolvedValue([song('netease')])
    await resolveBilibiliSongIdentity(video)
    expect(h.netease).toHaveBeenCalledTimes(3)
  })

  it('账号交换或平台关闭后，旧搜索结果不能发布', async () => {
    const upstream = deferred<Track[]>()
    h.netease.mockReturnValue(upstream.promise)
    const result = resolveBilibiliSongIdentity(video)
    await vi.waitFor(() => expect(h.netease).toHaveBeenCalledOnce())
    advanceProviderAccountSession('netease')
    upstream.resolve([song('netease')])
    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
    expect(matchedBilibiliTrack(video)).toBeUndefined()

    const next = deferred<Track[]>()
    h.netease.mockReturnValue(next.promise)
    const disabled = resolveBilibiliSongIdentity(video)
    await vi.waitFor(() => expect(h.netease).toHaveBeenCalledTimes(2))
    useSettingsStore.setState({ lyricsPlatformSources: { netease: false, qq: true, apple: false, qishui: false } })
    next.resolve([song('netease')])
    await expect(disabled).rejects.toMatchObject({ name: 'AbortError' })
    expect(matchedBilibiliTrack(video)).toBeUndefined()
  })

  it.each(['apple', 'qishui'] as const)('仅启用 %s 时仍可识别并直接按该平台 ID 取词', async source => {
    useSettingsStore.setState({ lyricsPlatformSources: { netease: false, qq: false, apple: source === 'apple', qishui: source === 'qishui' } })
    useProviderStore.setState({ byId: {
      ...useProviderStore.getState().byId,
      [source]: { enabled: true, auth: 'authenticated' },
    } })
    h[source].mockResolvedValue([{ ...song('netease'), id: 'only-source', source, provider: source }])
    expect((await findBilibiliLyricMatch(video, source))?.track.id).toBe('only-source')
    expect(h[source]).toHaveBeenCalledOnce()
    expect(h.netease).not.toHaveBeenCalled()
    expect(h.qq).not.toHaveBeenCalled()
  })

  it('网络失败不缓存为未匹配，重试可以找到歌曲', async () => {
    h.netease.mockRejectedValue(new Error('offline'))
    h.qq.mockRejectedValue(new Error('offline'))
    await expect(resolveBilibiliSongIdentity(video)).rejects.toThrow('offline')
    h.netease.mockResolvedValue([song('netease')])
    expect((await resolveBilibiliSongIdentity(video))?.track.id).toBe(186016)
    expect(h.netease).toHaveBeenCalledTimes(2)
  })

  it.each(['apple', 'qishui'] as const)('网易和 QQ 未收录时仍查询明确选择的 %s', async source => {
    h.netease.mockResolvedValue([])
    h.qq.mockResolvedValue([])
    useSettingsStore.setState({ lyricsPlatformSources: { netease: true, qq: true, apple: true, qishui: true } })
    useProviderStore.setState({ byId: { ...useProviderStore.getState().byId, [source]: { enabled: true, auth: 'authenticated' } } })
    h[source].mockResolvedValue([{ ...song('netease'), id: 'target-song', source, provider: source }])
    expect((await findBilibiliLyricMatch(video, source))?.track.id).toBe('target-song')
    expect(h[source]).toHaveBeenCalledOnce()
    expect(matchedBilibiliTrack(video)).toMatchObject({ id: 'target-song', source })
    expect((await resolveBilibiliSongIdentity(video))?.track.id).toBe('target-song')
    expect(h.netease).toHaveBeenCalledTimes(2)
  })

  it('主曲库连接失败不阻断明确选择的其他平台，取消错误仍丢弃', async () => {
    h.netease.mockRejectedValue(new Error('offline'))
    h.qq.mockRejectedValue(new Error('offline'))
    useSettingsStore.setState({ lyricsPlatformSources: { netease: true, qq: true, apple: false, qishui: true } })
    h.qishui.mockResolvedValue([{ ...song('netease'), source: 'qishui', provider: 'qishui' }])
    expect((await findBilibiliLyricMatch(video, 'qishui'))?.track.source).toBe('qishui')
    expect(h.qishui).toHaveBeenCalledOnce()
  })
})
