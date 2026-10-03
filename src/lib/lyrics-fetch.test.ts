import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'
import { fetchLyrics } from './lyrics-fetch'
import type { Track } from '../types/domain'
import { TRACK_MATCH_SCHEMA } from './track-match'

const h = vi.hoisted(() => ({ netease: vi.fn(), qq: vi.fn(), native: vi.fn(), local: vi.fn() }))
vi.mock('./local-music-service', () => ({ localMusicService: { getLyrics: h.local } }))
vi.mock('./apple-lyrics', () => ({ fetchNativeAppleLyrics: h.native }))
vi.mock('./api', () => ({ api: { get: vi.fn() } }))
vi.mock('../providers/registry', () => ({ providerFor: (source: 'netease' | 'qq') => ({
  catalog: { searchTracks: h[source], getTracksByIds: vi.fn() },
}) }))
const apple: Track = { source: 'apple', provider: 'apple', type: 'song', id: 'a1', name: '晴天', artist: '周杰伦', artists: [], duration: 180_000 }
const song = (source: 'netease' | 'qq', extra: Partial<Track> = {}): Track => ({ ...apple, source, provider: source, id: source === 'qq' ? 12 : 34, mid: source === 'qq' ? 'qmid' : undefined, ...extra })

beforeEach(() => {
  vi.resetAllMocks()
  h.native.mockResolvedValue(null)
  h.netease.mockResolvedValue([song('netease')])
  h.qq.mockResolvedValue([song('qq')])
  vi.mocked(api.get).mockResolvedValue({ lyric: '[00:10.00]主歌词\n[00:20.00]下一句', tlyric: '[00:10.00]翻译', roma: '[00:10.00]romaji' })
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
    const result = await fetchLyrics({ ...apple, source: 'local', provider: 'local' })
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
