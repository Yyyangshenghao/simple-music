import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'
import { queryLyricsSource, candidateAvailability } from './lyrics-source-query'
import { clearProviderRequestCache } from './provider-request-cache'
import { advanceProviderAccountSession } from './provider-account-session'
import { useProviderStore } from '../stores/providers'
import { useSettingsStore } from '../stores/settings'
import type { Track } from '../types/domain'

const h = vi.hoisted(() => ({ netease: vi.fn(), qq: vi.fn(), native: vi.fn(), local: vi.fn(), identity: vi.fn() }))
vi.mock('./api', () => ({ api: { get: vi.fn() } }))
vi.mock('./apple-lyrics', () => ({ fetchNativeAppleLyrics: h.native }))
vi.mock('./local-music-service', () => ({ localMusicService: {
  getLyrics: h.local,
  getLyricSource: async (track: unknown, signal?: AbortSignal) => ({ lines: (await h.local(track, signal)) ?? [], identity: h.identity(track) ?? null }),
} }))
vi.mock('../providers/registry', () => ({ providerFor: (source: 'netease' | 'qq') => ({
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
  vi.stubGlobal('localStorage', undefined)
  useSettingsStore.setState({ lyricsAmllFallback: true, lyricsKugouFallback: true, lyricsAmllHost: 'auto' })
  useProviderStore.setState({ byId: {
    netease: { enabled: true, auth: 'authenticated' },
    qq: { enabled: true, auth: 'authenticated' },
    apple: { enabled: true, auth: 'authenticated' },
  } })
  h.netease.mockResolvedValue([song('netease')])
  h.qq.mockResolvedValue([song('qq')])
  h.native.mockResolvedValue(null)
  h.local.mockResolvedValue([{ time: 1, text: '本地歌词' }])
  vi.mocked(api.get).mockResolvedValue({ lyric: '[00:01.00]甲乙' })
})
afterEach(() => vi.unstubAllGlobals())

describe('来源锁定', () => {
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
    expect(vi.mocked(api.get).mock.calls.map(([path]) => path)).toEqual(['/api/lyric', '/api/amll/lyric'])
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
    expect(await queryLyricsSource(song('local'), 'apple', ['qq', 'apple'])).toMatchObject({ status: 'unavailable' })
  })

  it('Apple 原生不能作为其他平台的候选', () => {
    expect(candidateAvailability(song('netease'), 'apple', ['apple'])).toMatchObject({ status: 'unavailable' })
  })

  it('来源关闭或未登录时，记住的同曲引用不能绕过参与限制', async () => {
    expect(await queryLyricsSource(song('apple'), 'qq', [], undefined, song('qq'))).toMatchObject({ status: 'disabled' })
    useProviderStore.setState(state => ({ byId: { ...state.byId, qq: { enabled: true, auth: 'anonymous' } } }))
    expect(await queryLyricsSource(song('apple'), 'qq', ['qq'], undefined, song('qq'))).toMatchObject({ status: 'login' })
    expect(api.get).not.toHaveBeenCalled()
    expect(h.qq).not.toHaveBeenCalled()
  })

  it('AMLL 需要已参与的网易或 QQ，Apple 记忆匹配不能绕过', async () => {
    expect(await queryLyricsSource(song('apple'), 'amll', ['apple'], undefined, song('qq'))).toMatchObject({ status: 'unavailable' })
    useSettingsStore.setState({ lyricsAmllFallback: false, lyricsKugouFallback: false })
    expect(await queryLyricsSource(song('netease'), 'amll', ['netease'])).toMatchObject({ status: 'disabled' })
    expect(await queryLyricsSource(song('netease'), 'kugou', ['netease'])).toMatchObject({ status: 'disabled' })
    expect(api.get).not.toHaveBeenCalled()
  })

  it('Apple 可通过已参与平台匹配 AMLL，仅使用该平台映射', async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) => (path === '/api/amll/lyric' ? { text: qrc } : { lyric: '' }) as never)
    expect(await queryLyricsSource(song('apple'), 'amll', ['qq'])).toMatchObject({ status: 'ready', match: { source: 'qq' }, result: { origin: 'amll' } })
    expect(h.qq).toHaveBeenCalledOnce()
    expect(h.netease).not.toHaveBeenCalled()
  })

  it('查询中退出账号后，迟到的同曲不能请求歌词', async () => {
    h.qq.mockImplementation(async () => { advanceProviderAccountSession('qq'); return [song('qq')] })
    await expect(queryLyricsSource(song('apple'), 'qq', ['qq'])).rejects.toMatchObject({ name: 'AbortError' })
    expect(api.get).not.toHaveBeenCalled()
  })

  it('AMLL 辅助层加载期间停用映射平台后不能再查询该平台 ID', async () => {
    vi.mocked(api.get).mockImplementation(async () => {
      useProviderStore.setState(state => ({ byId: { ...state.byId, netease: { ...state.byId.netease, enabled: false } } }))
      return { lyric: '' } as never
    })
    expect(await queryLyricsSource(song('netease'), 'amll', ['netease'])).toMatchObject({ status: 'unavailable' })
    expect(api.get).toHaveBeenCalledTimes(1)
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
    h.qq.mockResolvedValueOnce([])
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

  it('保存过的同曲必须重新校验，不复用错误录音', async () => {
    h.qq.mockResolvedValueOnce([])
    const remembered = song('qq', { name: '晴天 (Live)' })
    expect(await queryLyricsSource(song('apple'), 'qq', ['qq'], undefined, remembered)).toMatchObject({ status: 'empty' })
    expect(h.qq).toHaveBeenCalledOnce()
    expect(api.get).not.toHaveBeenCalled()
  })

  it('保存过的可靠同曲不必重复搜索，但仍校验时间轴', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ lyric: '[03:10.00]错误时间轴' })
    expect(await queryLyricsSource(song('apple'), 'qq', ['qq'], undefined, song('qq'))).toMatchObject({ status: 'mismatch' })
    expect(h.qq).not.toHaveBeenCalled()
  })
})

describe('游客歌词来源', () => {
  beforeEach(() => {
    useSettingsStore.setState({ lyricsGuestSources: { netease: true, qq: true } })
    useProviderStore.setState({ byId: {
      netease: { enabled: true, auth: 'anonymous' }, qq: { enabled: false, auth: 'authenticated' }, apple: { enabled: true, auth: 'authenticated' },
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
    expect(candidateAvailability(song('apple'), 'netease', ['netease'])).toMatchObject({ status: 'login', message: '登录或开启游客查询后可查找' })
    expect(candidateAvailability(song('apple'), 'qq', ['qq'])).toMatchObject({ status: 'disabled' })
  })
})
