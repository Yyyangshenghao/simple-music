import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Track } from '../types/domain'
import { useProviderStore } from '../stores/providers'
import { useSettingsStore } from '../stores/settings'
import { matchedBilibiliTrack, useBilibiliCoverStore } from '../stores/bilibili-covers'
import { advanceProviderAccountSession } from './provider-account-session'
import { clearBilibiliSongIdentityCache, confirmBilibiliSongCandidate, getBilibiliSongCandidates, findBilibiliLyricMatch, resolveBilibiliSongIdentity } from './bilibili-song-identity'

const h = vi.hoisted(() => ({ netease: vi.fn(), qq: vi.fn(), apple: vi.fn(), qishui: vi.fn() }))
vi.mock('../providers/registry', () => ({ providerFor: (source: 'netease' | 'qq' | 'apple' | 'qishui') => ({ catalog: { searchTracks: h[source] } }) }))
vi.mock('./lyric-service', async original => ({ ...(await original<typeof import('./lyric-service')>()),
  searchGuestTracks: (source: 'netease' | 'qq', keyword: string) => h[source](keyword),
}))
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
    expect(h.qq).toHaveBeenCalledOnce()
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

  it('多读法每个平台最多四次搜索，空结果短期复用', async () => {
    h.netease.mockResolvedValue([])
    h.qq.mockResolvedValue([])
    const ambiguous = { ...video, name: '周杰伦 - 晴天', videoTitle: '周杰伦 - 晴天' }
    expect(await resolveBilibiliSongIdentity(ambiguous)).toBeNull()
    expect(await resolveBilibiliSongIdentity(ambiguous)).toBeNull()
    expect(h.netease.mock.calls).toEqual([['周杰伦 晴天'], ['晴天 周杰伦'], ['周杰伦'], ['晴天']])
    expect(h.qq).toHaveBeenCalledTimes(4)
  })

  it('跨平台候选一起比较，歧义结果不能靠平台顺序掩盖', async () => {
    h.netease.mockResolvedValue([])
    expect((await resolveBilibiliSongIdentity(video))?.track.source).toBe('qq')
    clearBilibiliSongIdentityCache()
    useBilibiliCoverStore.setState({ entries: {} })
    h.netease.mockResolvedValue([song('netease'), song('netease', { id: 'other', name: '周杰伦', artist: '晴天', artists: [{ id: 2, name: '晴天' }] })])
    h.qq.mockClear()
    await expect(findBilibiliLyricMatch({ ...video, videoTitle: '周杰伦 - 晴天' }, 'netease', undefined, true)).rejects.toThrow('TRACK_VERSION_MISMATCH')
    expect(h.qq).toHaveBeenCalledTimes(2)
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

  it.each(['账号交换', '平台关闭'])('%s 不取消独立游客探测，也不造成重复搜索', async change => {
    const upstream = deferred<Track[]>()
    h.netease.mockReturnValue(upstream.promise)
    const result = resolveBilibiliSongIdentity(video)
    await vi.waitFor(() => expect(h.netease).toHaveBeenCalledOnce())
    if (change === '账号交换') advanceProviderAccountSession('netease')
    else useSettingsStore.setState({ lyricsPlatformSources: { netease: false, qq: false, apple: false, qishui: false } })
    upstream.resolve([song('netease')])
    expect((await result)?.track.id).toBe(186016)
    expect(matchedBilibiliTrack(video)?.name).toBe('晴天')
    expect((await resolveBilibiliSongIdentity(video))?.track.id).toBe(186016)
    expect(h.netease).toHaveBeenCalledOnce()
  })

  it.each(['apple', 'qishui'] as const)('仅启用 %s 时，游客识别仍运行，显式歌词来源可按规范身份映射', async source => {
    useSettingsStore.setState({ lyricsPlatformSources: { netease: false, qq: false, apple: source === 'apple', qishui: source === 'qishui' } })
    useProviderStore.setState({ byId: {
      ...useProviderStore.getState().byId,
      [source]: { enabled: true, auth: 'authenticated' },
    } })
    h[source].mockResolvedValue([{ ...song('netease'), id: 'only-source', source, provider: source }])
    expect((await findBilibiliLyricMatch(video, source))?.track.id).toBe('only-source')
    expect(h[source]).toHaveBeenCalledOnce()
    expect(h.netease).toHaveBeenCalledOnce()
    expect(h.qq).toHaveBeenCalledOnce()
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


it('第二个平台有更高分时采用更高分歌曲，复用已探测的平台候选取歌词', async () => {
  h.netease.mockResolvedValue([song('netease', { duration: 271_900 })])
  const best = await resolveBilibiliSongIdentity(video)
  expect(best?.track.source).toBe('qq')
  expect(best?.score).toBe(100)
  expect((await findBilibiliLyricMatch(video, 'netease'))?.track.source).toBe('netease')
  expect(h.netease).toHaveBeenCalledTimes(2)
})

it('独立歌名探测能挽救组合词搜索不到的曲目', async () => {
  h.netease.mockImplementation(async (query: string) => query === '晴天' ? [song('netease')] : [])
  h.qq.mockResolvedValue([])
  expect((await resolveBilibiliSongIdentity({ ...video, videoTitle: '《晴天》令人怀念的夏天' }))?.track.name).toBeUndefined()
  const candidates = await getBilibiliSongCandidates({ ...video, videoTitle: '《晴天》令人怀念的夏天' })
  expect(candidates).toHaveLength(1)
  expect(candidates[0].track.name).toBe('晴天')
})

it('歧义候选由用户确认后歌词和封面共用同一身份，伪造候选和旧上下文均拒绝', async () => {
  const origin = { ...video, videoTitle: '《晴天》', duration: 280_000 }
  h.netease.mockResolvedValue([song('netease')])
  h.qq.mockResolvedValue([song('qq')])
  const candidates = await getBilibiliSongCandidates(origin)
  expect(candidates).toHaveLength(1)
  expect(matchedBilibiliTrack(origin)).toBeUndefined()
  expect(() => confirmBilibiliSongCandidate(origin, song('netease', { id: 'forged' }))).toThrow('过期')
  confirmBilibiliSongCandidate(origin, { ...candidates[0].track, cover: 'https://forged.test' })
  expect(matchedBilibiliTrack(origin)).toMatchObject({ name: '晴天', cover: 'https://example.com/album.jpg', bilibiliIdentityConfirmed: true })
  expect((await findBilibiliLyricMatch(origin, 'netease'))?.track.id).toBe(186016)
  clearBilibiliSongIdentityCache()
  expect((await resolveBilibiliSongIdentity(origin))?.track.id).toBe(186016)
  expect(await getBilibiliSongCandidates(origin)).toEqual([])
  expect(() => confirmBilibiliSongCandidate({ ...origin, duration: 281_000 }, candidates[0].track)).toThrow('过期')
})

it('跨平台同名异歌手不会因为首个平台命中而自动采用', async () => {
  h.qq.mockResolvedValue([song('qq', { artist: '其他歌手', artists: [{ id: 2, name: '其他歌手' }] })])
  const origin = { ...video, videoTitle: '《晴天》' }
  expect(await resolveBilibiliSongIdentity(origin)).toBeNull()
  const candidates = await getBilibiliSongCandidates(origin)
  expect(candidates).toHaveLength(2)
  confirmBilibiliSongCandidate(origin, candidates[1].track)
  expect((await resolveBilibiliSongIdentity(origin))?.track.artist).toBe('其他歌手')
})


it('部分关键词网络失败不缓存为未匹配，下一次可重新探测', async () => {
  h.netease.mockResolvedValueOnce([song('netease', { name: '无关歌曲' })]).mockRejectedValue(new Error('offline'))
  h.qq.mockResolvedValue([])
  await expect(getBilibiliSongCandidates(video)).rejects.toThrow('offline')
  h.netease.mockResolvedValue([song('netease')])
  expect((await resolveBilibiliSongIdentity(video))?.track.name).toBe('晴天')
})

it('用户确认的歌手不会因原平台停用被同名其他歌手覆盖', async () => {
  const origin = { ...video, videoTitle: '《晴天》' }
  const other = song('netease', { id: 'chosen', artist: '已确认歌手', artists: [{ id: 2, name: '已确认歌手' }] })
  h.netease.mockResolvedValue([other])
  h.qq.mockResolvedValue([song('qq')])
  const candidates = await getBilibiliSongCandidates(origin)
  confirmBilibiliSongCandidate(origin, candidates.find(item => item.track.id === 'chosen')!.track)
  useSettingsStore.setState({ lyricsPlatformSources: { netease: false, qq: true, apple: false, qishui: false } })
  expect((await resolveBilibiliSongIdentity(origin))?.track.artist).toBe('已确认歌手')
  expect(await getBilibiliSongCandidates(origin, undefined, true)).toEqual([])
  expect((await resolveBilibiliSongIdentity(origin))?.track.artist).toBe('已确认歌手')
  expect(await findBilibiliLyricMatch(origin, 'qq')).toBeNull()
  expect(matchedBilibiliTrack(origin)?.artist).toBe('已确认歌手')
})

it('显式重新查找绕过未匹配缓存，游客候选确认不受账号变化影响', async () => {
  h.netease.mockResolvedValue([])
  h.qq.mockResolvedValue([])
  expect(await getBilibiliSongCandidates(video)).toEqual([])
  h.netease.mockResolvedValue([song('netease')])
  expect(await getBilibiliSongCandidates(video, undefined, true)).toEqual([])
  expect(matchedBilibiliTrack(video)?.name).toBe('晴天')
  clearBilibiliSongIdentityCache()
  useBilibiliCoverStore.setState({ entries: {} })
  const origin = { ...video, videoTitle: '《晴天》', duration: 280_000 }
  const offered = await getBilibiliSongCandidates(origin)
  advanceProviderAccountSession('netease')
  expect(() => confirmBilibiliSongCandidate(origin, offered[0].track)).not.toThrow()
  expect(matchedBilibiliTrack(origin)?.name).toBe('晴天')
})


it('单个平台探测超时不阻塞已成功的平台', async () => {
  vi.useFakeTimers()
  try {
    h.netease.mockReturnValue(new Promise(() => {}))
    const pending = resolveBilibiliSongIdentity(video)
    await vi.advanceTimersByTimeAsync(4501)
    expect((await pending)?.track.source).toBe('qq')
  } finally { vi.useRealTimers() }
})
