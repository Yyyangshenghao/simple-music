import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'
import { queryLyricsSource, candidateAvailability } from './lyrics-source-query'
import { clearProviderRequestCache } from './provider-request-cache'
import { advanceProviderAccountSession } from './provider-account-session'
import { fetchLyrics } from './lyrics-fetch'
import { clearBilibiliSongIdentityCache } from './bilibili-song-identity'
import { useBilibiliCoverStore } from '../stores/bilibili-covers'
import { useLyricsSourceStore } from '../stores/lyrics-source'
import { useProviderStore, isProviderParticipating } from '../stores/providers'
import { useSettingsStore } from '../stores/settings'
import type { Track } from '../types/domain'

const h = vi.hoisted(() => ({ netease: vi.fn(), qq: vi.fn(), apple: vi.fn(), qishui: vi.fn(), native: vi.fn(), local: vi.fn(), identity: vi.fn() }))
vi.mock('./api', () => ({ api: { get: vi.fn() } }))
vi.mock('./apple-lyrics', () => ({ fetchNativeAppleLyrics: h.native }))
vi.mock('./local-music-service', () => ({ localMusicService: {
  getLyrics: h.local,
  getLyricSource: async (track: unknown, signal?: AbortSignal) => ({ lines: (await h.local(track, signal)) ?? [], identity: h.identity(track) ?? null }),
} }))
vi.mock('../providers/registry', () => ({ providerFor: (source: 'netease' | 'qq' | 'apple' | 'qishui') => ({
  catalog: { searchTracks: h[source], getTracksByIds: vi.fn() },
}) }))

const song = (source: Track['source'], extra: Partial<Track> = {}): Track => ({
  id: source === 'qq' ? 'qmid' : '1', mid: source === 'qq' ? 'qmid' : undefined, source, provider: source, type: 'song',
  name: '晴天', artist: '周杰伦', artists: [], duration: 180_000, ...extra,
})
const qrc = '[1000,1000]甲(1000,500)乙(1500,500)'
const yrc = '[1000,1000](1000,500,0)甲(1500,500,0)乙'
const krc = '[1000,1000]<0,500,0>甲<500,500,0>乙'

beforeEach(() => {
  // 以下用例校验账号参与语义；游客歌词来源在单独的用例里打开。
  useSettingsStore.setState({ lyricsGuestSources: { netease: false, qq: false } })
  vi.resetAllMocks()
  clearProviderRequestCache()
  clearBilibiliSongIdentityCache()
  useBilibiliCoverStore.setState({ entries: {} })
  useLyricsSourceStore.setState({ health: {}, probes: {} })
  vi.stubGlobal('localStorage', undefined)
  useSettingsStore.setState({ lyricsAmllFallback: true, lyricsKugouFallback: true })
  useProviderStore.setState({ byId: {
    netease: { enabled: true, auth: 'authenticated' },
    qq: { enabled: true, auth: 'authenticated' },
    apple: { enabled: true, auth: 'authenticated' }, qishui: { enabled: false, auth: 'anonymous' }, kugou: { enabled: false, auth: 'authenticated' }, bilibili: { enabled: false, auth: 'anonymous' },
  } })
  h.netease.mockResolvedValue([song('netease')])
  h.qq.mockResolvedValue([song('qq')])
  h.apple.mockResolvedValue([song('apple', { id: 'a1' })])
  h.qishui.mockResolvedValue([])
  h.native.mockResolvedValue(null)
  h.local.mockResolvedValue([{ time: 1, text: '本地歌词' }])
  vi.mocked(api.get).mockImplementation(async (path, params) => {
    if (path === '/api/search' || path === '/api/qq/search') return { songs: await h[path === '/api/search' ? 'netease' : 'qq'](String(params?.keywords)) } as never
    return { lyric: '[00:01.00]甲乙' } as never
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('来源锁定', () => {
  it('手动歌词搜索使用输入的歌名歌手，即使查询原平台也不直接使用原曲 ID', async () => {
    const track = song('netease', { id: 'old-id', name: '错误歌名', artist: '错误歌手' })
    const search = { name: '晴天', artist: '周杰伦' }
    const setItem = vi.fn()
    vi.stubGlobal('localStorage', { getItem: () => null, setItem })
    const response = await queryLyricsSource(track, 'netease', ['netease'], undefined, undefined, { search })
    expect(h.netease).toHaveBeenCalledWith('晴天 周杰伦')
    expect(setItem).not.toHaveBeenCalled()
    expect(response).toMatchObject({ status: 'ready', match: { id: '1' } })
    expect(track).toMatchObject({ id: 'old-id', name: '错误歌名', artist: '错误歌手' })
  })

  it('手动查询 B 站时使用输入身份，并继续校验时长', async () => {
    const track = song('bilibili', { name: '难以识别的视频', videoTitle: '难以识别的视频', duration: 200_000 })
    const options = { search: { name: '晴天', artist: '周杰伦' } }
    expect(await queryLyricsSource(track, 'netease', ['netease'], undefined, undefined, options)).toMatchObject({ status: 'mismatch' })
    expect(h.netease).toHaveBeenCalledWith('晴天 周杰伦')
    expect(vi.mocked(api.get).mock.calls.some(([path]) => path === '/api/lyric')).toBe(false)
  })

  it('用户输入无版本标注的歌名时仍保留原录音的现场标记', async () => {
    const track = song('qq', { name: '晴天（现场）' })
    const search = { name: '晴天', artist: '周杰伦' }
    expect(await queryLyricsSource(track, 'netease', ['netease'], undefined, undefined, { search })).toMatchObject({ status: 'mismatch' })
    expect(h.netease).toHaveBeenCalledWith('晴天 周杰伦')
    expect(api.get).not.toHaveBeenCalled()
  })

  it('手动查询酷狗自己的歌曲也按输入关键词搜索', async () => {
    const track = song('kugou', { id: 'original-hash' })
    const options = { search: { name: '晴天', artist: '周杰伦' } }
    vi.mocked(api.get).mockResolvedValue({ candidates: [{ title: '晴天', artist: '周杰伦', duration: 180_000, text: krc }] })
    expect(await queryLyricsSource(track, 'kugou', [], undefined, undefined, options)).toMatchObject({ status: 'ready' })
    expect(api.get).toHaveBeenCalledWith('/api/kugou/lyric', { title: '晴天', artist: '周杰伦', duration: '180000' }, expect.anything())
  })

  it.each([
    ['【4K修复】周杰伦 - 晴天MV 2160P修复版', '周杰伦'],
    ['【Hi-Res】《晴天》周杰伦', '周杰伦'],
  ])('按 B 站视频标题 %s 提取歌名查词', async (name, artist) => {
    const track = song('bilibili', { name, artist: '上传账号', id: 'BV1BZbSzZEGT' })
    const result = await queryLyricsSource(track, 'netease', ['netease'])
    expect(h.netease).toHaveBeenCalledWith(`晴天 ${artist}`)
    expect(result).toMatchObject({ status: 'ready', match: { name: '晴天' } })
    expect(track.name).toBe(name)
  })

  it('B 站简介明确标注歌名和演唱者时优先使用这组信息', async () => {
    const track = song('bilibili', { name: '晴天现场之外的随手记录', bilibiliLyricHint: { name: '晴天', artists: ['周杰伦'] } })
    // 保留原视频标题的版本校验，即使简介给了明确的歌名和歌手。
    expect(await queryLyricsSource(track, 'netease', ['netease'])).toMatchObject({ status: 'mismatch' })
    expect(h.netease).toHaveBeenCalledWith('晴天 周杰伦')
    h.netease.mockClear()
    expect(await queryLyricsSource({ ...track, name: '一个音乐视频' }, 'netease', ['netease'])).toMatchObject({ status: 'ready' })
    expect(h.netease).toHaveBeenCalledWith('晴天 周杰伦')
  })

  it('简介和标题的明确歌名冲突时不自动套歌词', async () => {
    const track = song('bilibili', { name: '周杰伦《夜曲》', bilibiliLyricHint: { name: '晴天', artists: ['周杰伦'] } })
    expect(await queryLyricsSource(track, 'netease', ['netease'])).toMatchObject({ status: 'empty' })
    expect(h.netease).not.toHaveBeenCalled()
  })

  it('两种 B 站标题读法都能查到酷狗歌词时不任取其一', async () => {
    const track = song('bilibili', { name: '周杰伦 - 晴天' })
    vi.mocked(api.get).mockImplementation(async (_path, params) => ({
      candidates: [{ title: params?.title, artist: params?.artist, duration: 180_000, text: krc }],
    }) as never)
    expect(await queryLyricsSource(track, 'kugou', [])).toMatchObject({ status: 'mismatch' })
    expect(vi.mocked(api.get).mock.calls.filter(([path]) => path === '/api/kugou/lyric')).toHaveLength(2)
  })

  it.each([182_900, 180_000])('比较 B 站横线两侧的读法（第一种候选时长 %i）', async (duration) => {
    const track = song('bilibili', { name: '周杰伦 - 晴天' })
    h.netease.mockImplementation(async (keyword: string) => {
      if (keyword === '周杰伦 晴天') return [song('netease', { id: 'reversed', name: '周杰伦', artist: '晴天', duration })]
      if (keyword === '晴天 周杰伦') return [song('netease', { id: 'correct' })]
      return []
    })
    const result = await queryLyricsSource(track, 'netease', ['netease'])
    expect(h.netease).toHaveBeenCalledTimes(duration === 180_000 ? 4 : 2)
    expect(result).toMatchObject(duration === 180_000 ? { status: 'mismatch' } : { status: 'ready', match: { id: 'correct' } })
  })

  it('酷狗用 B 站视频中解析出的歌名和歌手查询', async () => {
    const track = song('bilibili', { name: '上传时的显示标题', videoTitle: '晴天 - 周杰伦', artist: '上传账号' })
    vi.mocked(api.get).mockResolvedValue({ candidates: [{ title: '晴天', artist: '周杰伦', duration: 180_000, text: krc }] })
    expect(await queryLyricsSource(track, 'kugou', [])).toMatchObject({ status: 'ready', result: { origin: 'kugou' } })
    expect(api.get).toHaveBeenCalledWith('/api/kugou/lyric', { title: '晴天', artist: '周杰伦', duration: '180000' }, expect.anything())
  })

  it.each(['【现场】周杰伦《晴天》', '周杰伦《晴天》女声完整版'])('提取 B 站歌名后仍拒绝给 %s 套用录音室歌词', async (name) => {
    const track = song('bilibili', { name, artist: '上传账号' })
    expect(await queryLyricsSource(track, 'netease', ['netease'])).toMatchObject({ status: 'mismatch' })
    expect(h.netease).toHaveBeenCalledWith('晴天')
    expect(vi.mocked(api.get).mock.calls.some(([path]) => path === '/api/lyric' || path === '/api/qq/lyric')).toBe(false)
  })

  it('网易和 QQ 未收录时，仍可用酷狗可靠 KRC 兜底', async () => {
    h.netease.mockResolvedValue([])
    h.qq.mockResolvedValue([])
    const track = song('bilibili', { name: '周杰伦《晴天》', artist: '上传账号' })
    vi.mocked(api.get).mockResolvedValue({ candidates: [{ title: '晴天', artist: '周杰伦', duration: 180_000, text: krc }] })
    expect(await queryLyricsSource(track, 'kugou', ['netease', 'qq'])).toMatchObject({ status: 'ready', result: { origin: 'kugou' } })
    expect(api.get).toHaveBeenCalledWith('/api/kugou/lyric', expect.objectContaining({ title: '晴天', artist: '周杰伦' }), expect.anything())
  })

  it('选 QQ 可取原生逐字，但绝不升级成 AMLL 或酷狗', async () => {
    vi.mocked(api.get).mockResolvedValue({ qrc })
    const result = await queryLyricsSource(song('netease'), 'qq', ['netease', 'qq'])
    expect(result).toMatchObject({ status: 'ready', result: { source: 'qq', main: [{ time: 1, text: '甲乙' }] }, match: { source: 'qq' } })
    expect(result.result?.origin).toBeUndefined()
    expect(api.get).toHaveBeenCalledOnce()
    expect(api.get).toHaveBeenCalledWith('/api/qq/lyric', expect.objectContaining({ words: '1' }), expect.anything())
  })

  it('Apple 原生失败不会搜索其他来源', async () => {
    expect(await queryLyricsSource(song('apple'), 'apple', ['apple', 'qq'])).toMatchObject({ status: 'empty' })
    expect(h.qq).not.toHaveBeenCalled()
    expect(h.netease).not.toHaveBeenCalled()
    expect(api.get).not.toHaveBeenCalled()
  })

  it('原生已具备逐字时依然能主动选 AMLL，保留对应翻译来源', async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) => (path === '/api/amll/lyric'
      ? { text: yrc } : { yrc, tlyric: '[00:01.00]译文' }) as never)
    await fetchLyrics(song('netease'))
    const result = await queryLyricsSource(song('netease'), 'amll', ['netease'])
    expect(result).toMatchObject({ status: 'ready', result: {
      source: 'netease', origin: 'amll', translationOrigin: 'netease', aligned: [{ time: 1, text: '译文' }],
    } })
    expect(api.get).toHaveBeenCalledTimes(2)
    expect(h.qq).not.toHaveBeenCalled()
  })

  it('AMLL 未收录时不会改查酷狗或返回平台原生歌词', async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) => (path === '/api/amll/lyric'
      ? { text: null } : { yrc }) as never)
    expect(await queryLyricsSource(song('netease'), 'amll', ['netease'])).toMatchObject({ status: 'empty' })
    expect(vi.mocked(api.get).mock.calls.map(([path]) => path)).toEqual(['/api/amll/lyric'])
  })

  it('酷狗只查询自身，原生平台不参与且能标记自带译文', async () => {
    const language = Buffer.from(JSON.stringify({ content: [{ type: 1, lyricContent: [['译文']] }] })).toString('base64')
    vi.mocked(api.get).mockResolvedValue({ candidates: [{ title: '晴天', artist: '周杰伦', duration: 180_000, text: `${krc}\n[language:${language}]` }] })
    expect(await queryLyricsSource(song('apple'), 'kugou', [])).toMatchObject({ status: 'ready', result: { origin: 'kugou', translationOrigin: 'kugou' } })
    expect(h.native).not.toHaveBeenCalled()
    expect(h.qq).not.toHaveBeenCalled()
    expect(api.get).toHaveBeenCalledTimes(1)
  })
})

describe('参与限制和取消', () => {
  it('本地标签不完整时只读本地文件，任何在线来源都不会请求', async () => {
    for (const origin of ['netease', 'qq', 'apple', 'amll', 'kugou'] as const) {
      expect(await queryLyricsSource(song('local'), origin, ['netease', 'qq', 'apple'])).toMatchObject({ status: 'unavailable' })
    }
    expect(await queryLyricsSource(song('local'), 'local', [])).toMatchObject({ status: 'ready', result: { source: 'local' } })
    expect(api.get).not.toHaveBeenCalled()
    expect(h.qq).not.toHaveBeenCalled()
  })

  it('本地标签齐全时可手动选在线来源，按标签身份匹配；选本地来源从不在线查询', async () => {
    const identity = song('local', { localTagged: true })
    h.identity.mockReturnValue(identity)
    h.local.mockResolvedValue([])
    vi.mocked(api.get).mockResolvedValue({ qrc })
    expect(await queryLyricsSource(song('local', { name: 'track01', artist: '未知艺人' }), 'qq', ['qq']))
      .toMatchObject({ status: 'ready', result: { source: 'qq' }, match: { source: 'qq' } })
    expect(h.qq).toHaveBeenCalledWith('晴天 周杰伦')
    vi.mocked(api.get).mockClear()
    h.qq.mockClear()
    expect(await queryLyricsSource(song('local'), 'local', ['qq'])).toMatchObject({ status: 'empty' })
    expect(api.get).not.toHaveBeenCalled()
    expect(h.qq).not.toHaveBeenCalled()
  })

  it('Apple 歌词缺翻译时按正文从原平台补齐翻译与音译，自带翻译不覆盖', async () => {
    h.native.mockResolvedValue({ source: 'apple', main: [{ time: 1.2, text: 'Hello' }, { time: 3, text: 'World' }], aligned: [], roma: [], wordLines: [] })
    vi.mocked(api.get).mockResolvedValue({ lyric: '[00:01.00]Hello\n[00:03.10]World', tlyric: '[00:01.00]你好\n[00:03.10]世界' })
    const filled = await queryLyricsSource(song('netease'), 'apple', ['netease', 'apple'])
    expect(filled.result).toMatchObject({ source: 'apple', translationOrigin: 'netease',
      main: [{ time: 1.2, text: 'Hello' }, { time: 3, text: 'World' }], aligned: [{ time: 1.2, text: '你好' }, { time: 3, text: '世界' }] })
    expect(filled.result?.romajiOrigin).toBeUndefined()

    h.native.mockResolvedValue({ source: 'apple', main: [{ time: 1.2, text: 'Hello' }], aligned: [{ time: 1.2, text: '哈喽' }], roma: [], wordLines: [] })
    expect((await queryLyricsSource(song('netease'), 'apple', ['netease', 'apple'])).result?.aligned).toEqual([{ time: 1.2, text: '哈喽' }])

    // 原平台在歌词设置中关闭时不再请求它补翻译。
    h.native.mockResolvedValue({ source: 'apple', main: [{ time: 1.2, text: 'Hello' }], aligned: [], roma: [], wordLines: [] })
    useSettingsStore.setState({ lyricsPlatformSources: { netease: false, qq: true, apple: true, qishui: true } })
    vi.mocked(api.get).mockClear()
    const plain = await queryLyricsSource(song('netease'), 'apple', ['netease', 'apple'])
    expect(plain).toMatchObject({ status: 'ready', result: { aligned: [] } })
    expect(api.get).not.toHaveBeenCalledWith('/api/lyric', expect.anything(), expect.anything())
  })

  it('Apple Music 可为其他平台歌曲匹配同一录音并取自带歌词；未连接或关闭时不查询', async () => {
    h.native.mockResolvedValue({ source: 'apple', main: [{ time: 1, text: '甲乙' }], aligned: [], roma: [], wordLines: [] })
    expect(await queryLyricsSource(song('netease'), 'apple', ['netease', 'apple']))
      .toMatchObject({ status: 'ready', result: { source: 'apple' }, match: { source: 'apple', id: 'a1' } })
    expect(h.native).toHaveBeenCalledWith(expect.objectContaining({ source: 'apple', id: 'a1' }), expect.anything(), true)
    useSettingsStore.setState({ lyricsPlatformSources: { netease: true, qq: true, apple: false, qishui: true } })
    expect(candidateAvailability(song('netease'), 'apple', ['apple'])).toMatchObject({ status: 'disabled', message: '已在设置中关闭' })
    useSettingsStore.setState({ lyricsPlatformSources: { netease: true, qq: true, apple: true, qishui: true } })
    useProviderStore.setState(state => ({ byId: { ...state.byId, apple: { enabled: true, auth: 'expired' }, kugou: { enabled: false, auth: 'authenticated' } } }))
    expect(candidateAvailability(song('netease'), 'apple', ['apple'])).toMatchObject({ status: 'login' })
    expect(candidateAvailability(song('netease'), 'apple', ['apple'], true)).toMatchObject({ status: 'login' })
    useProviderStore.setState(state => ({ byId: { ...state.byId, apple: { enabled: false, auth: 'authenticated' }, kugou: { enabled: false, auth: 'authenticated' } } }))
    expect(candidateAvailability(song('netease'), 'apple', ['apple'], true)).toMatchObject({ status: 'disabled', message: 'Apple Music 未启用' })
  })

  it('真实游客初始化后仍可查询歌词，播放权限保持关闭', async () => {
    useSettingsStore.setState({ lyricsGuestSources: { netease: true, qq: true } })
    expect(await queryLyricsSource(song('apple'), 'qq', [], undefined, song('qq'))).toMatchObject({ status: 'disabled' })
    useProviderStore.getState().setAccountState('qq', 'anonymous')
    expect(isProviderParticipating('qq')).toBe(false)
    expect(await queryLyricsSource(song('apple'), 'qq', ['qq'], undefined, song('qq'))).toMatchObject({ status: 'ready' })
    expect(isProviderParticipating('qq')).toBe(false)
  })

  it('AMLL 需要已参与的网易或 QQ，Apple 记忆匹配不能绕过', async () => {
    expect(await queryLyricsSource(song('apple', { id: 'i.lib' }), 'amll', ['apple'], undefined, song('qq'))).toMatchObject({ status: 'unavailable' })
    useSettingsStore.setState({ lyricsAmllFallback: false, lyricsKugouFallback: false })
    expect(await queryLyricsSource(song('netease'), 'amll', ['netease'])).toMatchObject({ status: 'disabled' })
    expect(await queryLyricsSource(song('netease'), 'kugou', ['netease'])).toMatchObject({ status: 'disabled' })
    expect(api.get).not.toHaveBeenCalled()
  })

  it('Apple 曲目按自身目录 ID 直接查 AMLL 的 Apple 分区，不依赖网易云、QQ', async () => {
    vi.mocked(api.get).mockImplementation(async (path: string, params?: Record<string, unknown>) => (path === '/api/amll/lyric' && params?.platform === 'am' ? { text: yrc } : { text: null }) as never)
    expect(await queryLyricsSource(song('apple', { id: 'i.lib', catalogId: '1645308331' }), 'amll', ['apple'])).toMatchObject({ status: 'ready', match: { source: 'apple' }, result: { origin: 'amll', main: [{ time: 1, text: '甲乙' }] } })
    expect(api.get).toHaveBeenCalledWith('/api/amll/lyric', { platform: 'am', id: '1645308331' }, expect.anything())
    expect(h.qq).not.toHaveBeenCalled()
  })

  it('Apple 可通过已参与平台匹配 AMLL，仅使用该平台映射', async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) => (path === '/api/amll/lyric' ? { text: qrc } : { lyric: '' }) as never)
    expect(await queryLyricsSource(song('apple', { id: 'i.lib' }), 'amll', ['qq'])).toMatchObject({ status: 'ready', match: { source: 'qq' }, result: { origin: 'amll' } })
    expect(h.qq).toHaveBeenCalledOnce()
    expect(h.netease).not.toHaveBeenCalled()
  })

  it('查询中退出账号后，迟到的同曲不能请求歌词', async () => {
    h.qq.mockImplementation(async () => { advanceProviderAccountSession('qq'); return [song('qq')] })
    await expect(queryLyricsSource(song('apple'), 'qq', ['qq'])).rejects.toMatchObject({ name: 'AbortError' })
    expect(api.get).not.toHaveBeenCalled()
  })

  it('AMLL 不等待原生辅助请求，平台播放关闭也不影响公共歌词', async () => {
    useSettingsStore.setState({ lyricsGuestSources: { netease: true, qq: true } })
    vi.mocked(api.get).mockImplementation(async path => path === '/api/amll/lyric'
      ? { text: yrc } as never : await new Promise(() => {}))
    useProviderStore.getState().setAccountState('netease', 'anonymous')
    expect(await queryLyricsSource(song('netease'), 'amll', ['netease'])).toMatchObject({ status: 'ready' })
    expect(api.get).toHaveBeenCalledOnce()
  })

  it('取消查询后不会继续获取歌词', async () => {
    const controller = new AbortController()
    h.qq.mockImplementation(async () => { controller.abort(); return [song('qq')] })
    await expect(queryLyricsSource(song('apple'), 'qq', ['qq'], controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(api.get).not.toHaveBeenCalled()
  })
})

describe('真实结果与错误分类', () => {
  it('平台歌词为空是 empty，网络异常是 error', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ lyric: '' }).mockRejectedValueOnce(new Error('offline'))
    expect(await queryLyricsSource(song('netease'), 'netease', ['netease'])).toMatchObject({ status: 'empty' })
    expect(await queryLyricsSource(song('netease'), 'netease', ['netease'])).toMatchObject({ status: 'error' })
  })

  it('原生 Apple 网络异常保留 error 分类', async () => {
    h.native.mockRejectedValueOnce(new Error('offline'))
    expect(await queryLyricsSource(song('apple'), 'apple', ['apple'])).toMatchObject({ status: 'error' })
  })

  it('跨平台搜索失败是 error，不等同于未收录', async () => {
    h.qq.mockRejectedValueOnce(new Error('offline'))
    expect(await queryLyricsSource(song('apple'), 'qq', ['qq'])).toMatchObject({ status: 'error' })
    h.qq.mockResolvedValue([])
    expect(await queryLyricsSource(song('apple'), 'qq', ['qq'])).toMatchObject({ status: 'empty' })
  })

  it('搜索仅有错版本时是 mismatch', async () => {
    h.qq.mockResolvedValueOnce([song('qq', { name: '晴天 (Live)' })])
    expect(await queryLyricsSource(song('apple'), 'qq', ['qq'])).toMatchObject({ status: 'mismatch' })
    expect(api.get).not.toHaveBeenCalled()
  })

  it.each(['amll', 'kugou'] as const)('%s 未收录、错时间轴与网络失败分别分类', async origin => {
    const track = song('netease')
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === '/api/lyric') return { lyric: '' } as never
      return origin === 'amll' ? { text: null } : { candidates: [] } as never
    })
    expect(await queryLyricsSource(track, origin, ['netease'])).toMatchObject({ status: 'empty' })
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === '/api/lyric') return { lyric: '' } as never
      return origin === 'amll' ? { text: '[190000,1000](190000,1000,0)甲' }
        : { candidates: [{ title: '晴天', artist: '周杰伦', duration: 180_000, text: '[190000,1000]<0,1000,0>甲' }] } as never
    })
    expect(await queryLyricsSource(track, origin, ['netease'])).toMatchObject({ status: 'mismatch' })
    vi.mocked(api.get).mockRejectedValue(new Error('offline'))
    expect(await queryLyricsSource(track, origin, ['netease'])).toMatchObject({ status: 'error' })
  })

  it('本曲平台歌词末尾的 [99:00] 推广行不判错配，跨平台仍校验时长', async () => {
    vi.mocked(api.get).mockResolvedValue({ lyric: '[00:01.00]甲乙\n[99:00.01]本歌曲来自〖网易音乐人〗' })
    expect(await queryLyricsSource(song('netease'), 'netease', ['netease'])).toMatchObject({ status: 'ready' })
    clearProviderRequestCache()
    expect(await queryLyricsSource(song('qq'), 'netease', ['netease', 'qq'])).toMatchObject({ status: 'mismatch' })
  })

  it('保存过的同曲必须重新校验，不复用错误录音', async () => {
    h.qq.mockResolvedValue([])
    const remembered = song('qq', { name: '晴天 (Live)' })
    expect(await queryLyricsSource(song('apple'), 'qq', ['qq'], undefined, remembered)).toMatchObject({ status: 'empty' })
    expect(h.qq.mock.calls.map(([keyword]) => keyword)).toEqual(['晴天 周杰伦', '晴天'])
    expect(api.get).not.toHaveBeenCalled()
  })

  it('保存过的可靠同曲不必重复搜索，但仍校验时间轴', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ lyric: '[03:10.00]错误时间轴' })
    expect(await queryLyricsSource(song('apple'), 'qq', ['qq'], undefined, song('qq'))).toMatchObject({ status: 'mismatch' })
    expect(h.qq).not.toHaveBeenCalled()
  })
})


describe('连接异常暂停与自动恢复', () => {
  it('连续三次失败后冷却期内不再请求，手动测试成功可随时恢复', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('offline'))
    for (let i = 0; i < 3; i++) expect(await queryLyricsSource(song('netease'), 'netease', ['netease'])).toMatchObject({ status: 'error' })
    expect(await queryLyricsSource(song('netease'), 'netease', ['netease'])).toMatchObject({ status: 'unavailable' })
    expect(api.get).toHaveBeenCalledTimes(3)
    vi.mocked(api.get).mockResolvedValueOnce({ lyric: '' })
    expect(await queryLyricsSource(song('netease'), 'netease', ['netease'], undefined, undefined, { probe: true })).toMatchObject({ status: 'empty' })
    expect(useLyricsSourceStore.getState().health.netease?.suspended).toBe(true)
    vi.mocked(api.get).mockResolvedValue({ lyric: '[00:01.00]恢复' })
    expect(await queryLyricsSource(song('netease'), 'netease', ['netease'], undefined, undefined, { probe: true })).toMatchObject({ status: 'ready' })
    expect(useLyricsSourceStore.getState().health.netease?.suspended).toBe(false)
  })

  it('暂停 30 秒后自动放行试探，失败冷却翻倍，成功即恢复', async () => {
    vi.useFakeTimers()
    try {
      vi.mocked(api.get).mockRejectedValue(new Error('offline'))
      for (let i = 0; i < 3; i++) await queryLyricsSource(song('netease'), 'netease', ['netease'])
      vi.setSystemTime(Date.now() + 29_000)
      expect(await queryLyricsSource(song('netease'), 'netease', ['netease'])).toMatchObject({ status: 'unavailable' })
      vi.setSystemTime(Date.now() + 1_000)
      expect(await queryLyricsSource(song('netease'), 'netease', ['netease'])).toMatchObject({ status: 'error' })
      expect(useLyricsSourceStore.getState().health.netease).toMatchObject({ suspended: true, cooldownMs: 60_000 })
      expect(api.get).toHaveBeenCalledTimes(4)
      vi.setSystemTime(Date.now() + 60_000)
      vi.mocked(api.get).mockResolvedValue({ lyric: '[00:01.00]恢复' })
      expect(await queryLyricsSource(song('netease'), 'netease', ['netease'])).toMatchObject({ status: 'ready' })
      expect(useLyricsSourceStore.getState().health.netease).toEqual({ failures: 0, suspended: false })
    } finally { vi.useRealTimers() }
  })

  it('未收录中断连续失败计数', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ lyric: '' }).mockRejectedValueOnce(new Error('offline'))
    for (let i = 0; i < 3; i++) await queryLyricsSource(song('netease'), 'netease', ['netease'])
    expect(useLyricsSourceStore.getState().health.netease).toEqual({ failures: 1, suspended: false })
  })

  it('映射平台搜索失败不会暂停从未访问的 AMLL', async () => {
    h.qq.mockRejectedValue(new Error('offline'))
    for (let i = 0; i < 4; i++) expect(await queryLyricsSource(song('apple', { id: 'i.lib' }), 'amll', ['qq'])).toMatchObject({ status: 'error' })
    expect(useLyricsSourceStore.getState().health.amll).toBeUndefined()
    expect(api.get).not.toHaveBeenCalled()
  })

  it('映射搜索超时不计入 AMLL，原生超时则计数', async () => {
    vi.useFakeTimers()
    try {
      h.qq.mockReturnValue(new Promise(() => {}))
      const mapping = queryLyricsSource(song('apple', { id: 'i.lib' }), 'amll', ['qq'])
      await vi.advanceTimersByTimeAsync(8000)
      expect(await mapping).toMatchObject({ status: 'error', message: '连接超时' })
      expect(useLyricsSourceStore.getState().health.amll).toBeUndefined()
      vi.mocked(api.get).mockReturnValue(new Promise(() => {}))
      const native = queryLyricsSource(song('netease'), 'netease', ['netease'])
      await vi.advanceTimersByTimeAsync(8000)
      expect(await native).toMatchObject({ status: 'error' })
      expect(useLyricsSourceStore.getState().health.netease?.failures).toBe(1)
    } finally { vi.useRealTimers() }
  })
})


it('AMLL 正常未收录后第二映射失败或超时不算目标库故障', async () => {
  vi.mocked(api.get).mockResolvedValue({ text: null })
  h.qq.mockRejectedValue(new Error('mapping offline'))
  expect(await queryLyricsSource(song('netease'), 'amll', ['netease', 'qq'])).toMatchObject({ status: 'error' })
  expect(useLyricsSourceStore.getState().health.amll).toEqual({ failures: 0, suspended: false })
  vi.useFakeTimers()
  try {
    h.qq.mockReturnValue(new Promise(() => {}))
    const pending = queryLyricsSource(song('netease'), 'amll', ['netease', 'qq'])
    await vi.advanceTimersByTimeAsync(8000)
    expect(await pending).toMatchObject({ status: 'error' })
    expect(useLyricsSourceStore.getState().health.amll).toEqual({ failures: 0, suspended: false })
  } finally { vi.useRealTimers() }
})
describe('游客歌词来源', () => {
  beforeEach(() => {
    useSettingsStore.setState({ lyricsGuestSources: { netease: true, qq: true } })
    useProviderStore.setState({ byId: {
      netease: { enabled: true, auth: 'anonymous' }, qq: { enabled: false, auth: 'authenticated' }, apple: { enabled: true, auth: 'authenticated' }, qishui: { enabled: false, auth: 'anonymous' }, kugou: { enabled: false, auth: 'authenticated' }, bilibili: { enabled: false, auth: 'anonymous' },
    } })
  })

  it('未登录或已停用的平台在开启游客查询时可作为来源，用游客搜索与歌词接口', async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) => (path === '/api/qq/search' ? { songs: [song('qq')] } : { qrc }) as never)
    expect(candidateAvailability(song('apple'), 'qq', ['qq'])).toEqual({ status: 'idle' })
    const result = await queryLyricsSource(song('apple'), 'qq', ['qq'])
    expect(result).toMatchObject({ status: 'ready', result: { source: 'qq' } })
    expect(h.qq).not.toHaveBeenCalled()
    expect(vi.mocked(api.get).mock.calls.every(([, params]) => (params as Record<string, string>).guest === '1')).toBe(true)
  })

  it('游客上游失败报告连接失败，不冒充未收录或登录失效', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('HTTP 502'))
    expect(await queryLyricsSource(song('apple'), 'netease', ['netease'])).toMatchObject({ status: 'error', message: '暂时连接失败' })
  })

  it('关闭游客查询后，未登录平台提示登录或开启，停用平台提示已关闭', () => {
    useSettingsStore.setState({ lyricsGuestSources: { netease: false, qq: false } })
    expect(candidateAvailability(song('apple'), 'netease', ['netease'])).toMatchObject({ status: 'login', message: '登录后可查找' })
    expect(candidateAvailability(song('apple'), 'qq', ['qq'])).toMatchObject({ status: 'disabled' })
  })

  it('设置中关闭平台后，即使已登录也显示已关闭', () => {
    useSettingsStore.setState({ lyricsGuestSources: { netease: true, qq: true }, lyricsPlatformSources: { netease: false, qq: true, apple: true, qishui: true } })
    expect(candidateAvailability(song('apple'), 'netease', ['netease'])).toMatchObject({ status: 'disabled', message: '已在设置中关闭' })
    useSettingsStore.setState({ lyricsPlatformSources: { netease: true, qq: true, apple: true, qishui: true } })
  })
})


it('B 站系统游客歌词不受播放平台、游客或歌词平台开关影响', async () => {
  useSettingsStore.setState({ lyricsGuestSources: { netease: false, qq: false }, lyricsPlatformSources: { netease: false, qq: false, apple: false, qishui: false } })
  useProviderStore.setState({ byId: { ...useProviderStore.getState().byId, netease: { enabled: false, auth: 'anonymous' }, qq: { enabled: false, auth: 'anonymous' } } })
  const track = song('bilibili', { name: '周杰伦《晴天》' })
  expect(candidateAvailability(track, 'netease', [])).toEqual({ status: 'idle' })
  expect(candidateAvailability(track, 'qq', [])).toEqual({ status: 'idle' })
  expect(candidateAvailability(track, 'amll', [])).toEqual({ status: 'idle' })
})


it('B 站原生游客取词不会因无关 Apple 账号变化丢弃响应', async () => {
  const track = song('bilibili', { name: '周杰伦《晴天》' })
  let finish!: (value: unknown) => void
  const original = vi.mocked(api.get).getMockImplementation()!
  vi.mocked(api.get).mockImplementation((path, ...args) => path === '/api/lyric'
    ? new Promise(resolve => { finish = resolve }) as never : original(path, ...args))
  const pending = queryLyricsSource(track, 'netease', ['netease', 'qq', 'apple'])
  await vi.waitFor(() => expect(finish).toBeDefined())
  advanceProviderAccountSession('apple')
  advanceProviderAccountSession('netease')
  finish({ lyric: '[00:01.00]系统游客歌词' })
  expect(await pending).toMatchObject({ status: 'ready', result: { main: [{ time: 1, text: '系统游客歌词' }] } })
  expect(api.get).toHaveBeenCalledWith('/api/lyric', expect.objectContaining({ guest: '1' }), expect.anything())
})


it('账号来源熔断不拦截 B 站系统游客，也不由游客结果修改账号健康状态', async () => {
  const health = { netease: { failures: 3, suspended: true, retryAt: Date.now() + 60_000 }, qq: { failures: 3, suspended: true, retryAt: Date.now() + 60_000 } }
  useLyricsSourceStore.setState({ health })
  const track = song('bilibili', { name: '周杰伦《晴天》' })
  expect(candidateAvailability(song('qq'), 'netease', ['netease']).status).toBe('unavailable')
  for (const origin of ['netease', 'qq'] as const) {
    expect(candidateAvailability(track, origin, [])).toEqual({ status: 'idle' })
    expect(await queryLyricsSource(track, origin, [])).toMatchObject({ status: 'ready' })
  }
  expect(useLyricsSourceStore.getState().health).toBe(health)
})
