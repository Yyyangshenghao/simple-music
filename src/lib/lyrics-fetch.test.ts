import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'
import { emptyLyrics, fetchLyrics, upgradeLyricsWithAmll, upgradeLyrics, upgradeLyricsWithKugou, type LyricsResult } from './lyrics-fetch'
import { advanceProviderAccountSession } from './provider-account-session'
import { useProviderStore } from '../stores/providers'
import type { Track } from '../types/domain'
import { TRACK_MATCH_SCHEMA } from './track-match'
import { clearProviderRequestCache } from './provider-request-cache'
import { useSettingsStore } from '../stores/settings'

const h = vi.hoisted(() => ({ netease: vi.fn(), qq: vi.fn(), native: vi.fn(), local: vi.fn(), identity: vi.fn() }))
vi.mock('./local-music-service', () => ({ localMusicService: {
  getLyrics: h.local,
  getLyricSource: async (track: unknown, signal?: AbortSignal) => ({ lines: (await h.local(track, signal)) ?? [], identity: h.identity(track) ?? null }),
} }))
vi.mock('./apple-lyrics', () => ({ fetchNativeAppleLyrics: h.native }))
vi.mock('./api', () => ({ api: { get: vi.fn() } }))
vi.mock('../providers/registry', () => ({ providerFor: (source: 'netease' | 'qq') => ({
  catalog: { searchTracks: h[source], getTracksByIds: vi.fn() },
}) }))
const apple: Track = { source: 'apple', provider: 'apple', type: 'song', id: 'a1', name: '晴天', artist: '周杰伦', artists: [], duration: 180_000 }
const song = (source: 'netease' | 'qq', extra: Partial<Track> = {}): Track => ({ ...apple, source, provider: source, id: source === 'qq' ? 12 : 34, mid: source === 'qq' ? 'qmid' : undefined, ...extra })

beforeEach(() => {
  // 以下用例校验账号参与语义；游客歌词来源在单独的用例里打开。
  useSettingsStore.setState({ lyricsGuestSources: { netease: false, qq: false } })
  clearProviderRequestCache()
  vi.resetAllMocks()
  // 这里的用例校验请求共享；AMLL 兜底单独覆盖，默认关掉免得多出一次请求
  useSettingsStore.setState({ lyricsAmllFallback: false, lyricsKugouFallback: false })
  h.native.mockResolvedValue(null)
  h.netease.mockResolvedValue([song('netease')])
  h.qq.mockResolvedValue([song('qq')])
  vi.mocked(api.get).mockResolvedValue({ lyric: '[00:10.00]主歌词\n[00:20.00]下一句', tlyric: '[00:10.00]翻译', roma: '[00:10.00]romaji' })
})

it('取消展示消费者不影响同曲预热且解析结果被复用', async () => {
  let finish!: (value: { lyric: string }) => void
  vi.mocked(api.get).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const controller = new AbortController()
  const preload = fetchLyrics(song('netease'))
  const display = fetchLyrics(song('netease'), [], controller.signal)
  controller.abort()
  finish({ lyric: '[00:01.00]共享歌词' })
  expect((await preload).main).toEqual([{ time: 1, text: '共享歌词' }])
  expect((await display).main).toEqual([])
  expect((await fetchLyrics(song('netease'))).main).toHaveLength(1)
  expect(api.get).toHaveBeenCalledOnce()
})
afterEach(() => vi.unstubAllGlobals())

describe('Apple Music 同曲歌词', () => {
  it('优先 Apple 原生歌词，即使没有启用其它音源或缺少时长', async () => {
    const native = { source: 'apple', main: [{ time: 1, text: '原生' }], aligned: [], roma: [], wordLines: [] }
    h.native.mockResolvedValue(native)
    expect(await fetchLyrics({ ...apple, duration: undefined })).toEqual(native)
    expect(h.qq).not.toHaveBeenCalled()
    expect(h.netease).not.toHaveBeenCalled()
  })
  it('只使用允许的音源，保留翻译并返回真实歌词来源', async () => {
    const before = { ...apple }
    const result = await fetchLyrics(apple, ['apple', 'qq'])
    expect(result).toMatchObject({ source: 'qq', main: [{ time: 10, text: '主歌词' }, { time: 20, text: '下一句' }] })
    expect(result.aligned[0].text).toBe('翻译')
    expect(result.roma[0].text).toBe('romaji')
    expect(result.wordLines).toEqual([])
    expect(api.get).toHaveBeenCalledWith('/api/qq/lyric', expect.objectContaining({ mid: 'qmid' }), expect.anything())
    expect(h.netease).not.toHaveBeenCalled()
    expect(apple).toEqual(before)
  })

  it.each([
    { name: '晴天 (Live)' }, { artist: '其他歌手' }, { duration: 195_000 }, { duration: undefined },
  ])('拒绝版本、歌手或时长不可靠的歌词匹配 %j', async extra => {
    h.qq.mockResolvedValue([song('qq', extra)])
    expect((await fetchLyrics(apple, ['qq'])).main).toEqual([])
    expect(api.get).not.toHaveBeenCalled()
  })

  it('双方录音编号不一致时不套用其他录音版本', async () => {
    h.qq.mockResolvedValue([song('qq', { isrc: 'OTHER' })])
    expect((await fetchLyrics({ ...apple, isrc: 'ORIGIN' }, ['qq'])).main).toEqual([])
    expect(api.get).not.toHaveBeenCalled()
  })

  it.each([{ name: '晴天 (Live)' }, { artist: '其他歌手' }, { duration: 195_000 }])('旧缓存中的不可靠版本也必须重新校验 %j', async extra => {
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify({ schema: TRACK_MATCH_SCHEMA, entries: {
      'apple:a1->qq': { targetId: 12, targetTrack: song('qq', extra), score: 100, verifiedAt: Date.now(), expiresAt: Date.now() + 10000 },
    } }) })
    expect((await fetchLyrics(apple, ['qq'])).main).toEqual([])
    expect(h.qq).not.toHaveBeenCalled()
    expect(api.get).not.toHaveBeenCalled()
  })

  it('上一音源无歌词时继续下一音源，缺少可用来源则不搜索', async () => {
    expect((await fetchLyrics(apple)).main).toEqual([])
    expect(h.netease).not.toHaveBeenCalled()
    expect(h.qq).not.toHaveBeenCalled()
    vi.mocked(api.get).mockResolvedValueOnce({ lyric: '' })
    expect((await fetchLyrics(apple, ['netease', 'qq'])).source).toBe('qq')
  })

  it('某个音源搜索失败不阻塞其他可用音源', async () => {
    h.netease.mockRejectedValueOnce(new Error('offline'))
    expect((await fetchLyrics(apple, ['netease', 'qq'])).main).toHaveLength(2)
  })

  it('切歌取消后，迟到的匹配不能继续请求歌词', async () => {
    let finish!: (tracks: Track[]) => void
    h.qq.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const controller = new AbortController()
    const pending = fetchLyrics(apple, ['qq'], controller.signal)
    await vi.waitFor(() => expect(h.qq).toHaveBeenCalled())
    controller.abort()
    finish([song('qq')])
    expect((await pending).main).toEqual([])
    expect(api.get).not.toHaveBeenCalled()
  })

  it('歌词时间超出歌曲长度时拒绝使用', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ lyric: '[05:00.00]不属于当前版本' })
    expect((await fetchLyrics(apple, ['qq'])).main).toEqual([])
  })

  it('网易与QQ原曲歌词继续直取，不额外匹配', async () => {
    expect((await fetchLyrics(song('netease'))).main).toHaveLength(2)
    expect((await fetchLyrics(song('qq'))).main).toHaveLength(2)
    expect(h.netease).not.toHaveBeenCalled()
    expect(h.qq).not.toHaveBeenCalled()
  })
})


describe('原生逐字时间轴', () => {
  it('QQ 翻译与音译也是 QRC 时保留它们的文本和时间轴', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ qrc: '[1000,1000]甲(1000,500)乙(1500,500)', tlyric: '[1000,1000]译文(1000,1000)', roma: '[1000,1000]a b(1000,1000)' })
    const result = await fetchLyrics(song('qq'))
    expect(result.aligned).toEqual([{ time: 1, text: '译文' }])
    expect(result.roma).toEqual([{ time: 1, text: 'a b' }])
  })
  it('网易逐字主歌词优先使用对应音译，避免旧时间轴偏移导致缺行', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      lyric: '[00:14.99]第一句\n[00:29.12]第二句',
      yrc: '[15250,1000](15250,1000,0)第一句\n[29620,1000](29620,1000,0)第二句',
      romalrc: '[00:14.99]old first\n[00:29.12]old second',
      yromalrc: '[00:15.25]native first\n[00:29.62]native second',
    })
    const result = await fetchLyrics(song('netease'))
    expect(result.roma).toEqual([{ time: 15.25, text: 'native first' }, { time: 29.62, text: 'native second' }])
  })

  it('对应音译缺少某行时保留时间匹配的旧音译', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      yrc: '[1000,500](1000,500,0)第一句\n[3000,500](3000,500,0)第二句',
      romalrc: '[00:01.00]old first\n[00:03.00]old second',
      yromalrc: '[00:01.00]native first',
    })
    expect((await fetchLyrics(song('netease'))).roma.map(line => line.text)).toEqual(['native first', 'old second'])
  })

  it.each([undefined, '', 'invalid'])('对应音译不可解析时回退到旧音译：%s', async yromalrc => {
    vi.mocked(api.get).mockResolvedValueOnce({
      yrc: '[1000,500](1000,500,0)正文', romalrc: '[00:01.00]old roma', yromalrc,
    })
    expect((await fetchLyrics(song('netease'))).roma).toEqual([{ time: 1, text: 'old roma' }])
  })

  it('普通 LRC 主歌词继续使用旧音译时间轴，不套用逐字音译', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      lyric: '[00:01.00]正文', yrc: 'invalid',
      romalrc: '[00:01.00]old roma', yromalrc: '[00:01.50]native roma',
    })
    expect((await fetchLyrics(song('netease'))).roma).toEqual([{ time: 1, text: 'old roma' }])
  })

  it('本地普通 LRC 保留逐句歌词，不再估算逐字时间', async () => {
    h.local.mockResolvedValue([{ time: 1, text: '本地歌词' }])
    const track: Track = { ...apple, source: 'local', provider: 'local' }
    const signal = new AbortController().signal
    const result = await fetchLyrics(track, [], signal)
    expect(h.local).toHaveBeenCalledWith(track, signal)
    expect(result.main).toEqual([{ time: 1, text: '本地歌词' }])
    expect(result.wordLines).toEqual([])
  })


  it('网易主歌词以 YRC 分句为准，翻译与罗马音按原生时间重新对齐', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      lyric: '[00:01.00]合并的一整句',
      yrc: '[1000,500](1000,500,0)第一句\n[3000,500](3000,500,0)第二句',
      tlyric: '[00:03.00]second', romalrc: '[00:03.00]dierju',
    })
    const result = await fetchLyrics(song('netease'))
    expect(result.main).toEqual([{ time: 1, text: '第一句' }, { time: 3, text: '第二句' }])
    expect(result.main.map(l => l.time)).toEqual(result.wordLines.map(l => l.time))
    expect(result.aligned.map(l => l.text)).toEqual(['', 'second'])
    expect(result.roma.map(l => l.text)).toEqual(['', 'dierju'])
  })

  it.each(['netease', 'qq'] as const)('%s 无 LRC 时仍可使用原生逐字歌词', async source => {
    vi.mocked(api.get).mockResolvedValueOnce(source === 'qq'
      ? { qrc: '[1000,1200]Hello (1000,400)world(1800,400)' }
      : { yrc: '[1000,1200](1000,400,0)Hello (1800,400,0)world' })
    const result = await fetchLyrics(song(source))
    expect(result.main).toEqual([{ time: 1, text: 'Hello world' }])
    expect(result.wordLines[0].words[1]).toEqual({ text: 'world', startMs: 800, durationMs: 400 })
  })

  it.each(['netease', 'qq'] as const)('%s 非法原生数据仍保留普通歌词', async source => {
    vi.mocked(api.get).mockResolvedValueOnce({ lyric: '[00:01.00]普通歌词', yrc: 'bad', qrc: 'bad' })
    const result = await fetchLyrics(song(source))
    expect(result.main).toEqual([{ time: 1, text: '普通歌词' }])
    expect(result.wordLines).toEqual([])
  })
})

describe('AMLL 逐字歌词兜底（异步升级）', () => {
  // 测试数据只用占位字符
  const yrc = '[1000,1000](1000,500,0)甲(1500,500,0)乙'
  const base = (extra: Partial<LyricsResult> = {}): LyricsResult => ({
    source: 'netease', main: [{ time: 1, text: '甲乙' }], aligned: [{ time: 1, text: '占位译文' }], roma: [], wordLines: [], ...extra
  })
  beforeEach(() => { useSettingsStore.setState({ lyricsAmllFallback: true, lyricsAmllHost: 'auto' }) })

  it('拉取不在 fetchLyrics 路径上，歌词先按行返回', async () => {
    vi.mocked(api.get).mockResolvedValue({ lyric: '[00:01.00]甲乙' } as never)
    const result = await fetchLyrics(song('netease'))
    expect(result.wordLines).toEqual([])
    expect(vi.mocked(api.get).mock.calls.some(([path]) => path === '/api/amll/lyric')).toBe(false)
  })

  it('升级为逐字版本并重新对应翻译', async () => {
    vi.mocked(api.get).mockResolvedValue({ text: yrc } as never)
    const upgraded = await upgradeLyricsWithAmll(song('netease'), base())
    expect(upgraded).toMatchObject({ source: 'netease', origin: 'amll' })
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/amll/lyric', { platform: 'ncm', id: '34', host: undefined }, { signal: undefined })
    expect(upgraded?.wordLines[0].words.map((w) => w.text)).toEqual(['甲', '乙'])
    expect(upgraded?.aligned[0]?.text).toBe('占位译文')
  })

  it('逐字版本合并了两句且行时间偏移时，音译按文本拼接到合并行', async () => {
    vi.mocked(api.get).mockResolvedValue({ text: '[1800,2000](1800,500,0)甲乙(2300,500,0)丙丁' } as never)
    const upgraded = await upgradeLyricsWithAmll(song('netease'), base({
      main: [{ time: 1, text: '甲乙' }, { time: 2, text: '丙丁' }],
      aligned: [],
      roma: [{ time: 1, text: 'a b' }, { time: 2, text: 'c d' }]
    }))
    expect(upgraded?.roma.map((l) => l.text)).toEqual(['a b c d'])
    expect(upgraded?.aligned).toEqual([])
  })

  it('用户指定线路时透传给 server；QQ 用 mid', async () => {
    useSettingsStore.setState({ lyricsAmllHost: 'gbclstudio' })
    vi.mocked(api.get).mockResolvedValue({ text: null } as never)
    await upgradeLyricsWithAmll(song('qq'), base({ source: 'qq' }))
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/amll/lyric', { platform: 'qq', id: 'qmid', host: 'gbclstudio' }, { signal: undefined })
  })

  it('QQ mid 未收录时继续用数字 qqId 查询', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ text: null }).mockResolvedValueOnce({ text: '[1000,1000]甲(1000,500)乙(1500,500)' })
    const upgraded = await upgradeLyricsWithAmll(song('qq', { qqId: 123456 }), base({ source: 'qq' }))
    expect(vi.mocked(api.get).mock.calls.map(([, params]) => params?.id)).toEqual(['qmid', '123456'])
    expect(upgraded?.wordLines[0].words.map(word => word.text)).toEqual(['甲', '乙'])
  })

  it('已有逐字、关闭开关、跨源匹配来的歌词都不请求', async () => {
    expect(await upgradeLyricsWithAmll(song('netease'), base({ wordLines: [{ time: 1, durationMs: 1000, words: [{ text: '甲', startMs: 0, durationMs: 500 }] }] }))).toBeNull()
    expect(await upgradeLyricsWithAmll(song('netease'), base({ source: 'qq' }))).toBeNull()
    useSettingsStore.setState({ lyricsAmllFallback: false, lyricsKugouFallback: false })
    expect(await upgradeLyricsWithAmll(song('netease'), base())).toBeNull()
    expect(api.get).not.toHaveBeenCalled()
  })

  it('时间轴超出本曲时长视为错配丢弃；请求失败返回 null', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ text: '[900000,1000](900000,500,0)丙' } as never)
    expect(await upgradeLyricsWithAmll(song('netease'), base())).toBeNull()
    vi.mocked(api.get).mockRejectedValueOnce(new Error('502'))
    expect(await upgradeLyricsWithAmll(song('netease'), base())).toBeNull()
  })
})

describe('后台跨平台逐字补全', () => {
  const base: LyricsResult = { source: 'netease', main: [{ time: 1, text: '甲乙' }], aligned: [], roma: [], wordLines: [] }
  const qrc = '[1000,1000]甲(1000,500)乙(1500,500)'

  it('QQ 原生 QRC 仅在后台补全请求，普通歌词请求不等待逐字服务', async () => {
    const qq = song('qq', { qqId: 123456 })
    vi.mocked(api.get).mockResolvedValueOnce({ lyric: '[00:01.00]甲乙' }).mockResolvedValueOnce({ qrc })
    const plain = await fetchLyrics(qq)
    expect(plain.wordLines).toEqual([])
    expect(vi.mocked(api.get)).toHaveBeenCalledOnce()
    expect(vi.mocked(api.get).mock.calls[0][1]).not.toHaveProperty('words')
    expect((await upgradeLyrics(qq, plain, ['qq']))?.wordLines[0].words).toHaveLength(2)
    expect(vi.mocked(api.get).mock.calls[1][1]).toMatchObject({ words: '1' })
  })

  it('原平台只有逐行歌词时，使用允许平台的可靠同曲逐字版本', async () => {
    vi.mocked(api.get).mockResolvedValue({ qrc })
    const upgraded = await upgradeLyrics(song('netease'), base, ['netease', 'qq', 'apple'])
    expect(upgraded?.source).toBe('qq')
    expect(upgraded?.wordLines[0].words).toHaveLength(2)
    expect(h.qq).toHaveBeenCalledOnce()
    expect(h.netease).not.toHaveBeenCalled()
  })

  it('各平台都只有逐行歌词时保持原来的歌词，不为换源而替换', async () => {
    expect(await upgradeLyrics(song('netease'), base, ['qq'])).toBeNull()
  })

  it.each([{ duration: undefined }, { duration: 195_000 }, { name: '晴天 (Live)' }, { artist: '其他歌手' }, { isrc: 'OTHER' }])('拒绝不可靠的同曲版本 %j', async extra => {
    h.qq.mockResolvedValue([song('qq', extra)])
    vi.mocked(api.get).mockResolvedValue({ qrc })
    expect(await upgradeLyrics(song('netease', { isrc: 'ORIGIN' }), base, ['qq'])).toBeNull()
    expect(api.get).not.toHaveBeenCalled()
  })

  it('逐字结束时间超出曲长也拒绝，不能只检查行起点', async () => {
    vi.mocked(api.get).mockResolvedValue({ qrc: '[179000,10000]甲(179000,10000)' })
    expect(await upgradeLyrics(song('netease'), base, ['qq'])).toBeNull()
  })

  it('已有真实逐字、本地文件、未允许的平台都不额外匹配', async () => {
    const timed = { ...base, wordLines: [{ time: 1, durationMs: 500, words: [{ text: '甲乙', startMs: 0, durationMs: 500 }] }] }
    expect(await upgradeLyrics(song('netease'), timed, ['qq'])).toBeNull()
    expect(await upgradeLyrics({ ...song('netease'), source: 'local' }, base, ['qq'])).toBeNull()
    expect(await upgradeLyrics(song('netease'), base, ['netease', 'apple'])).toBeNull()
    expect(h.qq).not.toHaveBeenCalled()
    expect(api.get).not.toHaveBeenCalled()
  })

  it('Apple 的空逐字占位行不能阻止继续补全', async () => {
    vi.mocked(api.get).mockResolvedValue({ qrc })
    const upgraded = await upgradeLyrics(apple, { ...base, source: 'apple', wordLines: [{ time: 1, durationMs: 1000, words: [] }] }, ['qq'])
    expect(upgraded?.wordLines[0].words).toHaveLength(2)
  })

  it('跨源匹配取消后不继续拉取歌词', async () => {
    const controller = new AbortController()
    h.qq.mockImplementation(async () => { controller.abort(); return [song('qq')] })
    expect(await upgradeLyrics(song('netease'), base, ['qq'], controller.signal)).toBeNull()
    expect(api.get).not.toHaveBeenCalled()
  })
})

describe('酷狗逐字歌词兜底', () => {
  const base: LyricsResult = { source: 'apple', main: [{ time: 1, text: '甲乙' }], aligned: [{ time: 1, text: '译文' }], roma: [], wordLines: [] }
  const krc = '[1000,1000]<0,500,0>甲<500,500,0>乙'
  const reply = (candidates: unknown[]) => vi.mocked(api.get).mockResolvedValue({ candidates } as never)
  beforeEach(() => { useSettingsStore.setState({ lyricsKugouFallback: true }) })

  it('按歌名、歌手与时长查询，同曲候选替换为逐字并保留原翻译', async () => {
    reply([{ title: '晴天', artist: '周杰伦', duration: 180_500, text: krc }])
    const upgraded = await upgradeLyricsWithKugou(apple, base)
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/kugou/lyric', { title: '晴天', artist: '周杰伦', duration: '180000' }, { signal: undefined })
    expect(upgraded).toMatchObject({ source: 'apple', origin: 'kugou', main: [{ time: 1, text: '甲乙' }], aligned: [{ time: 1, text: '译文' }] })
    expect(upgraded?.wordLines[0].words).toHaveLength(2)
  })

  it('KRC 自带翻译优先', async () => {
    const language = Buffer.from(JSON.stringify({ content: [{ type: 1, lyricContent: [['酷狗译文']] }] })).toString('base64')
    reply([{ title: '晴天', artist: '周杰伦', duration: 180_000, text: `${krc}\n[language:${language}]` }])
    expect((await upgradeLyricsWithKugou(apple, base))?.aligned).toEqual([{ time: 1, text: '酷狗译文' }])
  })

  it.each([
    { title: '晴天 (Live)', artist: '周杰伦', duration: 180_000 },
    { title: '晴天', artist: '其他歌手', duration: 180_000 },
    { title: '晴天', artist: '周杰伦', duration: 190_000 },
  ])('拒绝不可靠的候选 %j', async candidate => {
    reply([{ ...candidate, text: krc }])
    expect(await upgradeLyricsWithKugou(apple, base)).toBeNull()
  })

  it('跳过错配候选后使用下一个；时间轴超出曲长也拒绝', async () => {
    reply([
      { title: '晴天', artist: '周杰伦', duration: 180_000, text: '[179000,10000]<0,10000,0>甲' },
      { title: '晴天', artist: '周杰伦', duration: 180_000, text: krc },
    ])
    expect((await upgradeLyricsWithKugou(apple, base))?.wordLines[0].time).toBe(1)
  })

  it('关闭开关、本地文件、已有逐字或缺少时长时不请求', async () => {
    const timed = { ...base, wordLines: [{ time: 1, durationMs: 500, words: [{ text: '甲乙', startMs: 0, durationMs: 500 }] }] }
    expect(await upgradeLyricsWithKugou(apple, timed)).toBeNull()
    expect(await upgradeLyricsWithKugou({ ...apple, source: 'local' }, base)).toBeNull()
    expect(await upgradeLyricsWithKugou({ ...apple, duration: undefined }, base)).toBeNull()
    useSettingsStore.setState({ lyricsKugouFallback: false })
    expect(await upgradeLyricsWithKugou(apple, base)).toBeNull()
    expect(api.get).not.toHaveBeenCalled()
  })

  it('接口失败保持当前歌词', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('502'))
    expect(await upgradeLyricsWithKugou(apple, base)).toBeNull()
  })

  it('补全链最后才查酷狗，已登录平台命中时不查', async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) => (path === '/api/kugou/lyric'
      ? { candidates: [{ title: '晴天', artist: '周杰伦', duration: 180_000, text: krc }] }
      : { lyric: '[00:01.00]甲乙' }) as never)
    const upgraded = await upgradeLyrics(song('netease'), { ...base, source: 'netease' }, ['qq'])
    expect(upgraded?.wordLines).toHaveLength(1)
    const paths = vi.mocked(api.get).mock.calls.map(([path]) => path)
    expect(paths[paths.length - 1]).toBe('/api/kugou/lyric')
    expect(h.qq).toHaveBeenCalledOnce()
  })
})


describe('指定来源的错误诊断', () => {
  it('共享请求保留上游错误，普通调用仍返回空歌词，严格消费者可识别连接失败', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('offline'))
    const normal = fetchLyrics(song('netease'))
    const strict = fetchLyrics(song('netease'), [], undefined, false, true)
    await expect(normal).resolves.toMatchObject({ main: [] })
    await expect(strict).rejects.toThrow('offline')
    expect(api.get).toHaveBeenCalledOnce()
  })

  it('严格模式真正未收录仍返回空歌词，上游业务错误不能伪装成未收录', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ lyric: '' }).mockResolvedValueOnce({ error: 'UPSTREAM_FAILED' })
    await expect(fetchLyrics(song('netease'), [], undefined, false, true)).resolves.toMatchObject({ main: [] })
    await expect(fetchLyrics(song('netease'), [], undefined, false, true)).rejects.toThrow('UPSTREAM_FAILED')
  })
})

describe('游客歌词来源', () => {
  const guestApi = (path: string, params?: Record<string, string>) => {
    if (path === '/api/qq/search') return { songs: [song('qq')] }
    if (path === '/api/search') return { songs: [song('netease')] }
    if (path === '/api/qq/lyric') return { qrc: '[1000,1000]甲(1000,500)乙(1500,500)', tlyric: '[00:01.00]译文' }
    if (path === '/api/lyric') return { lyric: params?.guest === '1' ? '[00:01.00]游客' : '[00:01.00]账号' }
    return {}
  }

  beforeEach(() => {
    useSettingsStore.setState({ lyricsGuestSources: { netease: true, qq: true } })
    useProviderStore.setState({ byId: {
      netease: { enabled: true, auth: 'anonymous' }, qq: { enabled: true, auth: 'anonymous' }, apple: { enabled: true, auth: 'authenticated' },
    } as never })
    vi.mocked(api.get).mockImplementation(async (path: string, params?: unknown) => guestApi(path, params as Record<string, string>) as never)
  })

  it('Apple 曲目未登录 QQ 时以游客搜索并请求逐字（含翻译），不用账号搜索', async () => {
    const result = await fetchLyrics(apple, ['apple', 'qq'])
    expect(result).toMatchObject({ source: 'qq', main: [{ time: 1, text: '甲乙' }], aligned: [{ time: 1, text: '译文' }] })
    expect(h.qq).not.toHaveBeenCalled()
    expect(api.get).toHaveBeenCalledWith('/api/qq/search', expect.objectContaining({ guest: '1' }), expect.anything())
    expect(api.get).toHaveBeenCalledWith('/api/qq/lyric', expect.objectContaining({ guest: '1', words: '1' }), expect.anything())
  })

  it('游客与账号结果分开缓存；账号会话变化不作废游客结果', async () => {
    expect((await fetchLyrics(song('netease'))).main[0].text).toBe('游客')
    advanceProviderAccountSession('netease')
    expect((await fetchLyrics(song('netease'))).main[0].text).toBe('游客')
    expect(api.get).toHaveBeenCalledOnce()
    useProviderStore.setState(state => ({ byId: { ...state.byId, netease: { enabled: true, auth: 'authenticated' } } }))
    expect((await fetchLyrics(song('netease'))).main[0].text).toBe('账号')
    expect(api.get).toHaveBeenCalledTimes(2)
  })

  it('本地有歌词时不在线匹配；没有歌词只按标签身份匹配，只发送元数据', async () => {
    const local: Track = { ...apple, source: 'local', provider: 'local', id: 'file1', name: 'track01', artist: '未知艺人', path: '/music/私人/track01.mp3' }
    const identity: Track = { ...apple, source: 'local', provider: 'local', id: 'file1', localTagged: true }
    h.local.mockResolvedValue([{ time: 1, text: '本地歌词' }])
    h.identity.mockReturnValue(identity)
    expect((await fetchLyrics(local, ['netease', 'qq'])).main).toEqual([{ time: 1, text: '本地歌词' }])
    expect(api.get).not.toHaveBeenCalled()
    expect(await upgradeLyrics(local, await fetchLyrics(local, ['netease', 'qq']), ['netease', 'qq'])).toBeNull()

    h.local.mockResolvedValue([])
    const result = await fetchLyrics(local, ['netease', 'qq'])
    expect(result).toMatchObject({ source: 'netease', main: [{ time: 1, text: '游客' }] })
    const sent = JSON.stringify(vi.mocked(api.get).mock.calls)
    expect(sent).not.toContain('/music/')
    expect(sent).not.toContain('track01')
    expect(api.get).toHaveBeenCalledWith('/api/search', expect.objectContaining({ keywords: '晴天 周杰伦', guest: '1' }), expect.anything())
  })

  it('本地标签不全时不在线套词', async () => {
    h.local.mockResolvedValue([])
    h.identity.mockReturnValue(null)
    const local: Track = { ...apple, source: 'local', provider: 'local', id: 'file2' }
    expect((await fetchLyrics(local, ['netease', 'qq'])).main).toEqual([])
    expect(await upgradeLyrics(local, emptyLyrics, ['netease', 'qq'])).toBeNull()
    expect(api.get).not.toHaveBeenCalled()
  })

  it('本地身份同样经过版本、歌手、时长守卫', async () => {
    h.local.mockResolvedValue([])
    h.identity.mockReturnValue({ ...apple, source: 'local', provider: 'local', id: 'file3', localTagged: true, name: '晴天 (Live)' })
    expect((await fetchLyrics({ ...apple, source: 'local', provider: 'local', id: 'file3' }, ['netease', 'qq'])).main).toEqual([])
    expect(vi.mocked(api.get).mock.calls.map(([path]) => path)).toEqual(['/api/search', '/api/qq/search'])
  })
})
