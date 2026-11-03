import { beforeEach, describe, expect, it, vi } from 'vitest'
import { providerFor } from '../providers/registry'
import * as lyricService from './lyric-service'
import type { Track } from '../types/domain'
import {
  clearTrackMatchCache,
  findEquivalentTrack,
  matchBestTrack,
  normalizeMatchText,
  scoreTrackMatch,
  TrackMatchMismatchError,
} from './track-match'

function track(partial: Partial<Track> = {}): Track {
  return {
    provider: 'netease',
    source: 'netease',
    type: 'song',
    id: 'n-1',
    name: '晴天',
    artist: '周杰伦',
    artists: [{ id: 1, name: '周杰伦' }],
    album: '叶惠美',
    duration: 269_000,
    ...partial,
  }
}

describe('track match', () => {
  beforeEach(() => {
    const values: Record<string, string> = {}
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values[key] ?? null,
      setItem: (key: string, value: string) => { values[key] = value },
      removeItem: (key: string) => { delete values[key] },
    })
    clearTrackMatchCache()
    vi.restoreAllMocks()
  })

  it('归一化宽字符、大小写、标点和空白', () => {
    expect(normalizeMatchText('Ｍｏｊｉｔｏ （Live）！')).toBe('mojitolive')
  })

  it('标题与主要艺人一致即达到自动匹配阈值；缺少时长分数封顶', () => {
    expect(scoreTrackMatch(track({ duration: undefined, album: undefined }), track({
      source: 'qq',
      provider: 'qq',
      id: 'q-1',
      duration: undefined,
      album: undefined,
    }))).toBe(85)
  })

  it('艺人主名一致时兼容平台附加的括注别名', () => {
    const qq = track({
      source: 'qq',
      provider: 'qq',
      id: 'q-alias',
      name: '假装我们不需要呼吸',
      artist: '方拾贰',
      artists: [{ id: 1, name: '方拾贰' }],
      album: '假装我们不需要呼吸',
      duration: 244_000,
    })
    const netease = track({
      id: 'n-alias',
      name: '假装我们不需要呼吸',
      artist: '方拾贰（方十二）',
      artists: [{ id: 2, name: '方拾贰（方十二）' }],
      album: '假装我们不需要呼吸',
      duration: 244_000,
    })

    expect(scoreTrackMatch(qq, netease)).toBe(100)
    expect(scoreTrackMatch(qq, track({
      ...netease,
      artist: '玄舸（方拾贰）',
      artists: [{ id: 3, name: '玄舸（方拾贰）' }],
    }))).toBeNull()
  })

  it('不会移除艺人名开头的必要括号内容', () => {
    expect(scoreTrackMatch(track({
      artist: '(G)I-DLE',
      artists: [{ id: 1, name: '(G)I-DLE' }],
    }), track({
      source: 'qq',
      provider: 'qq',
      id: 'q-parenthesized',
      artist: 'GIDLE',
      artists: [{ id: 2, name: 'GIDLE' }],
    }))).toBe(100)
  })

  it('ISRC 一致且基础标题一致直接得到 100 分', () => {
    expect(scoreTrackMatch(track({ isrc: 'CN-A01-23-12345' }), track({
      source: 'qq',
      provider: 'qq',
      id: 'q-1',
      isrc: 'cn-a01-23-12345',
    }))).toBe(100)
  })

  it.each([
    ['版本标签冲突', track({ name: '晴天 (Live)' })],
    ['主要艺人无交集', track({ artist: '翻唱歌手', artists: [{ id: 2, name: '翻唱歌手' }] })],
    ['时长相差超过三秒', track({ duration: 272_001 })],
    ['加速版', track({ name: '晴天 (加速版)' })],
    ['语言版本不同', track({ name: '晴天 (日文版)' })],
    ['Taylor’s Version 重录', track({ name: '晴天 (Taylor’s Version)' })],
    ['短标题差一个字', track({ name: '晴天了' })],
    ['非版本括注不同', track({ name: '晴天 (Reprise)' })],
    ['完整版', track({ name: '晴天 (完整版)' })],
    ['童声版', track({ name: '晴天 (童声版)' })],
    ['混音版', track({ name: '晴天 (混音版)' })],
  ])('%s 时拒绝自动匹配', (_name, candidate) => {
    expect(scoreTrackMatch(track(), candidate)).toBeNull()
  })

  it('从候选中选择分数最高且达到阈值的曲目', () => {
    const basic = track({ source: 'qq', provider: 'qq', id: 'basic', duration: undefined, album: undefined })
    const exact = track({ source: 'qq', provider: 'qq', id: 'exact' })
    expect(matchBestTrack(track(), [basic, exact])).toEqual({ track: exact, score: 100, alternates: [{ track: basic, score: 85 }] })
  })

  it('繁简、括注宣传语、「 - X」后缀与 feat 不影响同曲判定', () => {
    expect(normalizeMatchText('周杰倫 說好的幸福呢')).toBe('周杰伦说好的幸福呢')
    expect(scoreTrackMatch(track(), track({ source: 'apple', provider: 'apple', id: 'a-1', name: '晴天', artist: '周杰倫', artists: [{ id: 2, name: '周杰倫' }], album: '葉惠美' }))).toBe(100)
    expect(scoreTrackMatch(track(), track({ source: 'qq', provider: 'qq', id: 'q-tv', name: '晴天（电影《不能说的秘密》插曲）', album: undefined }))).toBe(97)
    expect(scoreTrackMatch(track({ name: '晴天 (Live)' }), track({ source: 'qq', provider: 'qq', id: 'q-live', name: '晴天 - Live', album: undefined }))).toBe(100)
    expect(scoreTrackMatch(track(), track({ source: 'qq', provider: 'qq', id: 'q-feat', name: '晴天 (feat. 某人)', album: undefined }))).toBe(97)
  })

  it('外文署名靠平台资料里的别名对应，合唱版多署一位艺人仍视为一致', () => {
    const apple = track({ source: 'apple', provider: 'apple', id: 'a-2', artist: 'Jay Chou', artists: [{ id: 2, name: 'Jay Chou' }], album: 'Ye Hui Mei' })
    const qq = track({ source: 'qq', provider: 'qq', id: 'q-alias', artists: [{ id: 1, name: '周杰伦', aliases: ['Jay Chou'] }] })
    expect(scoreTrackMatch(apple, track())).toBeNull()
    expect(scoreTrackMatch(apple, qq)).toBe(93)
    expect(scoreTrackMatch(qq, apple)).toBe(93)
    expect(scoreTrackMatch(track({ artist: 'G.E.M.', artists: [{ id: 4, name: 'G.E.M.' }] }), track({ artist: 'G.E.M.邓紫棋', artists: [{ id: 5, name: 'G.E.M.邓紫棋', aliases: ['G.E.M.', 'Gloria Tang'] }] }))).toBe(98)
    expect(scoreTrackMatch(track(), track({ source: 'qq', provider: 'qq', id: 'q-duet', artist: '周杰伦/杨瑞代', artists: [{ id: 1, name: '周杰伦' }, { id: 3, name: '杨瑞代' }] }))).toBe(100)
  })

  it('中外文连写的署名可与其中文或外文部分对上（按别名计）', () => {
    const qq = track({ source: 'qq', provider: 'qq', id: 'q-gem', artist: 'G.E.M.邓紫棋', artists: [{ id: 5, name: 'G.E.M.邓紫棋' }], album: undefined })
    expect(scoreTrackMatch(track({ artist: '邓紫棋', artists: [{ id: 4, name: '邓紫棋' }], album: undefined }), qq)).toBe(93)
    expect(scoreTrackMatch(track({ artist: 'G.E.M.', artists: [{ id: 4, name: 'G.E.M.' }], album: undefined }), qq)).toBe(93)
    expect(scoreTrackMatch(track({ artist: '紫棋', artists: [{ id: 4, name: '紫棋' }], album: undefined }), qq)).toBeNull()
  })

  it('只靠别名对上的候选排在真名之后，且时长须相差 1.5 秒以内，挡住把知名歌手填作别名的翻唱账号', () => {
    const impostor = track({ source: 'netease', provider: 'netease', id: 'n-fake', artist: 'Jay', artists: [{ id: 9, name: 'Jay', aliases: ['周杰伦', '林俊杰'] }], album: undefined })
    const real = track({ source: 'netease', provider: 'netease', id: 'n-real', album: undefined })
    const origin = track({ source: 'qq', provider: 'qq', id: 'q-origin', album: undefined })
    expect(scoreTrackMatch(origin, { ...impostor, duration: 271_000 })).toBeNull()
    expect(matchBestTrack(origin, [impostor, real])).toMatchObject({ track: { id: 'n-real' }, score: 100, alternates: [{ track: { id: 'n-fake' }, score: 93 }] })
  })

  it('时长差按档降分，较长标题的个别错字只在时长接近时接受', () => {
    expect(scoreTrackMatch(track(), track({ source: 'qq', provider: 'qq', id: 'q-d', album: undefined, duration: 269_500 }))).toBe(97)
    expect(scoreTrackMatch(track(), track({ source: 'qq', provider: 'qq', id: 'q-d', album: undefined, duration: 271_000 }))).toBe(83)
    const long = track({ name: 'Everything I Wanted', album: undefined })
    expect(scoreTrackMatch(long, track({ source: 'qq', provider: 'qq', id: 'q-typo', name: 'Everythin I Wanted', album: undefined }))).toBe(90)
    expect(scoreTrackMatch(long, track({ source: 'qq', provider: 'qq', id: 'q-typo', name: 'Everythin I Wanted', album: undefined, duration: 271_000 }))).toBeNull()
    expect(scoreTrackMatch(track({ ...long, duration: undefined }), track({ source: 'qq', provider: 'qq', id: 'q-typo', name: 'Everythin I Wanted', album: undefined, duration: undefined }))).toBeNull()
    expect(scoreTrackMatch(track({ name: 'Etude Op.10 No.1', album: undefined }), track({ source: 'qq', provider: 'qq', id: 'q-no', name: 'Etude Op.10 No.2', album: undefined }))).toBeNull()
  })

  it('首级搜索无达标结果时依次降级到去括注标题 + 主歌手、只搜标题，合并候选并保留后备候选', async () => {
    const origin = track({ name: '晴天 (电影《不能说的秘密》插曲)', artist: '周杰伦/某人', artists: [{ id: 1, name: '周杰伦' }, { id: 2, name: '某人' }] })
    const best = track({ source: 'qq', provider: 'qq', id: 'q-best', name: '晴天' })
    const backup = track({ source: 'qq', provider: 'qq', id: 'q-backup', name: '晴天', album: undefined, duration: 270_000 })
    const search = vi.spyOn(providerFor('qq').catalog, 'searchTracks')
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([track({ source: 'qq', provider: 'qq', id: 'q-live', name: '晴天 (Live)' })])
      .mockResolvedValueOnce([best, backup])
    const result = await findEquivalentTrack(origin, 'qq', undefined, 1000)
    expect(search.mock.calls).toEqual([['晴天 (电影《不能说的秘密》插曲) 周杰伦/某人'], ['晴天 周杰伦'], ['晴天']])
    expect(result).toMatchObject({ track: { id: 'q-best' }, alternates: [{ track: { id: 'q-backup' } }] })
    await expect(findEquivalentTrack(origin, 'qq', undefined, 1001)).resolves.toMatchObject({ alternates: [{ track: { id: 'q-backup' } }] })
    expect(search).toHaveBeenCalledTimes(3)
  })

  it('出现达标候选即停止降级搜索；任何一级失败都抛出且不写负缓存', async () => {
    const weak = track({ source: 'qq', provider: 'qq', id: 'q-weak', album: undefined, duration: 271_000 })
    const search = vi.spyOn(providerFor('qq').catalog, 'searchTracks').mockResolvedValueOnce([weak])
    await expect(findEquivalentTrack(track(), 'qq', undefined, 1000)).resolves.toMatchObject({ track: { id: 'q-weak' }, score: 83 })
    expect(search).toHaveBeenCalledOnce()
    clearTrackMatchCache()
    search.mockReset().mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('HTTP 500'))
    await expect(findEquivalentTrack(track(), 'qq', undefined, 1000)).rejects.toThrow('HTTP 500')
    expect(localStorage.getItem('simplemusic-track-match-cache')).toBeNull()
  })

  it('新增版本词只看标题：专辑名带「演唱会」「DJ」不误伤录音室版本，「少女版」不算翻唱', () => {
    expect(scoreTrackMatch(track(), track({ source: 'qq', provider: 'qq', id: 'q-album', album: '演唱会精选 DJ Extended' }))).toBe(100)
    expect(scoreTrackMatch(track({ name: '少女版的梦' }), track({ source: 'qq', provider: 'qq', id: 'q-girl', name: '少女版的梦' }))).toBe(100)
    expect(scoreTrackMatch(track(), track({ source: 'qq', provider: 'qq', id: 'q-female', name: '晴天 (女声版)' }))).toBeNull()
  })

  it('命中缓存后复用去除临时 URL 的目标快照，不重复搜索', async () => {
    const provider = providerFor('qq')
    const matched = track({ source: 'qq', provider: 'qq', id: 'q-cache', url: 'https://expired.test/audio' })
    const search = vi.spyOn(provider.catalog, 'searchTracks').mockResolvedValue([matched])
    const getByIds = vi.spyOn(provider.catalog, 'getTracksByIds').mockResolvedValue([matched])

    await expect(findEquivalentTrack(track(), 'qq', undefined, 1000)).resolves.toEqual({
      track: expect.objectContaining({ id: 'q-cache' }),
      score: 100,
    })
    await expect(findEquivalentTrack(track(), 'qq', undefined, 1001)).resolves.toEqual({
      track: expect.not.objectContaining({ url: expect.anything() }),
      score: 100,
    })
    expect(search).toHaveBeenCalledTimes(1)
    expect(getByIds).not.toHaveBeenCalled()
  })

  it('游客匹配走游客搜索、独立缓存，播放匹配读不到也不会被覆盖', async () => {
    const matched = track({ source: 'qq', provider: 'qq', id: 'q-guest' })
    const guest = vi.spyOn(lyricService, 'searchGuestTracks').mockResolvedValue([matched])
    const account = vi.spyOn(providerFor('qq').catalog, 'searchTracks').mockResolvedValue([])
    const getByIds = vi.spyOn(providerFor('qq').catalog, 'getTracksByIds')
    await expect(findEquivalentTrack(track(), 'qq', undefined, 1000, false, false, 'guest')).resolves.toMatchObject({ track: { id: 'q-guest' } })
    expect(guest).toHaveBeenCalledWith('qq', '晴天 周杰伦', undefined)
    await expect(findEquivalentTrack(track(), 'qq', undefined, 1001)).resolves.toBeNull()
    expect(account.mock.calls).toEqual([['晴天 周杰伦'], ['晴天']])
    await expect(findEquivalentTrack(track(), 'qq', undefined, 1002, false, false, 'guest')).resolves.toMatchObject({ track: { id: 'q-guest' } })
    expect(guest).toHaveBeenCalledOnce()
    expect(getByIds).not.toHaveBeenCalled()
  })

  it('游客搜索为空不落盘负缓存（可能是上游限流），只在内存里短暂记住；失败直接抛出', async () => {
    const guest = vi.spyOn(lyricService, 'searchGuestTracks').mockResolvedValue([])
    await expect(findEquivalentTrack(track(), 'qq', undefined, 1000, true, false, 'guest')).resolves.toBeNull()
    await expect(findEquivalentTrack(track(), 'qq', undefined, 1001, true, false, 'guest')).resolves.toBeNull()
    expect(guest).toHaveBeenCalledTimes(2)
    expect(localStorage.getItem('simplemusic-track-match-cache')).toBeNull()
    await expect(findEquivalentTrack(track(), 'qq', undefined, 1000 + 5 * 60_000 + 1, true, false, 'guest')).resolves.toBeNull()
    expect(guest).toHaveBeenCalledTimes(4)
    guest.mockRejectedValueOnce(new Error('HTTP 500'))
    await expect(findEquivalentTrack(track({ id: 'n-2' }), 'qq', undefined, 1002, true, false, 'guest')).rejects.toThrow('HTTP 500')
  })

  it('未命中使用 24 小时负缓存', async () => {
    const provider = providerFor('qq')
    const search = vi.spyOn(provider.catalog, 'searchTracks').mockResolvedValue([])
    await expect(findEquivalentTrack(track(), 'qq', undefined, 1000)).resolves.toBeNull()
    await expect(findEquivalentTrack(track(), 'qq', undefined, 1001)).resolves.toBeNull()
    expect(search).toHaveBeenCalledTimes(2)
  })

  it('严格查询区分未找到候选与仅有错版本，负缓存保留该区别', async () => {
    const search = vi.spyOn(providerFor('qq').catalog, 'searchTracks')
      .mockResolvedValue([track({ source: 'qq', provider: 'qq', name: '晴天 (Live)' })])
    await expect(findEquivalentTrack(track(), 'qq', undefined, 1000, true)).rejects.toBeInstanceOf(TrackMatchMismatchError)
    await expect(findEquivalentTrack(track(), 'qq', undefined, 1001, true)).rejects.toBeInstanceOf(TrackMatchMismatchError)
    await expect(findEquivalentTrack(track(), 'qq', undefined, 1002)).resolves.toBeNull()
    expect(search).toHaveBeenCalledTimes(2)
    clearTrackMatchCache()
    search.mockResolvedValue([])
    await expect(findEquivalentTrack(track(), 'qq', undefined, 1003, true)).resolves.toBeNull()
  })

  it('严格查询不把旧版缺少诊断信息的负缓存误报成未收录', async () => {
    localStorage.setItem('simplemusic-track-match-cache', JSON.stringify({
      schema: 3,
      entries: { 'netease:n-1->qq': { verifiedAt: 1000, expiresAt: 86_401_000 } },
    }))
    const search = vi.spyOn(providerFor('qq').catalog, 'searchTracks')
      .mockResolvedValue([track({ source: 'qq', provider: 'qq', name: '晴天 (Live)' })])
    await expect(findEquivalentTrack(track(), 'qq', undefined, 1001, true)).rejects.toBeInstanceOf(TrackMatchMismatchError)
    expect(search).toHaveBeenCalledTimes(2)
  })

  it('匹配规则升级后忽略旧版负缓存并重新搜索', async () => {
    localStorage.setItem('simplemusic-track-match-cache', JSON.stringify({
      schema: 1,
      entries: {
        'netease:n-1->qq': { verifiedAt: 1000, expiresAt: 86_401_000 },
      },
    }))
    const provider = providerFor('qq')
    const matched = track({ source: 'qq', provider: 'qq', id: 'q-refreshed' })
    const search = vi.spyOn(provider.catalog, 'searchTracks').mockResolvedValue([matched])

    await expect(findEquivalentTrack(track(), 'qq', undefined, 1001)).resolves.toEqual({
      track: matched,
      score: 100,
    })
    expect(search).toHaveBeenCalledTimes(1)
  })
})

describe('哔哩哔哩视频候选', () => {
  const origin: Track = { provider: 'netease', source: 'netease', type: 'song', id: 1, name: '晴天', artist: '周杰伦', artists: [{ id: 1, name: '周杰伦' }], duration: 269_000 }
  const video = (name: string, artists: string[], duration = 269_000, id = 'BV1BZbSzZEGT'): Track => ({
    provider: 'bilibili', source: 'bilibili', type: 'song', id, name, artist: artists.join(' / '), artists: artists.map((item) => ({ id: null, name: item })), duration,
  })

  it('同一视频的多种读法都参与评分，正确读法胜出', () => {
    const result = matchBestTrack(origin, [video('周杰伦', ['晴天', 'UP']), video('晴天', ['周杰伦', 'UP'])])
    expect(result?.track.name).toBe('晴天')
  })

  it('时长差超过 3 秒或版本不同不算同一首', () => {
    expect(matchBestTrack(origin, [video('晴天', ['周杰伦', 'UP'], 317_000)])).toBeNull()
    expect(matchBestTrack(origin, [video('晴天_纯伴奏', ['UP'], 269_000)])).toBeNull()
  })
})
