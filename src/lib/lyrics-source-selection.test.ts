import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Track } from '../types/domain'
import type { LyricOrigin } from '../types/lyrics-source'
import type { LyricsResult } from './lyrics-fetch'
import { useLyricsStore } from '../stores/lyrics'
import { loadLyricsSourcePreferences, LYRICS_SOURCE_STORAGE_KEY, useLyricsSourceStore } from '../stores/lyrics-source'
import { usePlayerStore } from '../stores/player'
import { useProviderStore } from '../stores/providers'
import { useSettingsStore } from '../stores/settings'
import { useGameModeStore } from '../stores/game-mode'
import { usePlaylistStore } from '../stores/playlist'
import { advanceProviderAccountSession } from './provider-account-session'
import { reportLyricsSource, suspendedLyricsSource } from './lyrics-source-health'

const h = vi.hoisted(() => ({ fetch: vi.fn(), upgrade: vi.fn(), query: vi.fn(), available: vi.fn() }))
vi.mock('./lyrics-fetch', () => ({ fetchLyrics: h.fetch, upgradeLyrics: h.upgrade, emptyLyrics: { source: null, main: [], aligned: [], roma: [], wordLines: [] } }))
vi.mock('./lyrics-source-query', () => ({ queryLyricsSource: h.query, candidateAvailability: h.available }))
import { initLyricsLoader } from './lyrics-loader'
import { handlePlaybackRequest, takePlaybackSnapshot } from './playback-host-runtime'

const track: Track = { source: 'apple', provider: 'apple', type: 'song', id: 'a1', name: '歌曲', artist: '歌手', artists: [], duration: 180000 }
const initialPlayer = usePlayerStore.getState()
const initialProviders = useProviderStore.getState()
const initialSettings = useSettingsStore.getState()
let stop: (() => void) | undefined
let archive: Map<string, string>
const flush = async () => { for (let i = 0; i < 25; i++) await Promise.resolve() }
const result = (origin: LyricOrigin): LyricsResult => ({
  source: origin === 'amll' ? 'netease' : origin === 'kugou' ? 'apple' : origin,
  ...(origin === 'amll' || origin === 'kugou' ? { origin } : {}),
  main: [{ time: 0, text: `${origin} 第一行` }, { time: 15, text: `${origin} 第二行` }],
  aligned: [{ time: 0, text: `${origin} 翻译` }], roma: [], wordLines: [],
})
const action = (name: string, ...args: unknown[]) => handlePlaybackRequest({ type: 'action', store: 'lyricSources', action: name, args })
const deferred = () => {
  let resolve!: (value: { status: 'ready'; result: LyricsResult }) => void
  const promise = new Promise<{ status: 'ready'; result: LyricsResult }>(done => { resolve = done })
  return { promise, resolve }
}

beforeEach(() => {
  vi.clearAllMocks()
  archive = new Map()
  vi.stubGlobal('localStorage', { getItem: (key: string) => archive.get(key) ?? null, setItem: (key: string, value: string) => archive.set(key, value) })
  vi.spyOn(console, 'info').mockImplementation(() => {})
  h.fetch.mockReset().mockResolvedValue(result('apple'))
  h.upgrade.mockReset().mockResolvedValue(null)
  h.available.mockReset().mockReturnValue({ status: 'idle' })
  h.query.mockReset().mockImplementation(async (_track: Track, origin: LyricOrigin) => ({ status: 'ready', result: result(origin), match: { ...track, source: 'qq', provider: 'qq', id: 'q1', url: 'secret-url', cookie: 'secret-cookie' } }))
  usePlayerStore.setState({ ...initialPlayer, currentTrack: track, resolvedTrack: null, status: 'paused', position: 16 })
  useProviderStore.setState({ ...initialProviders, playbackOrder: ['apple', 'qq', 'netease'], byId: {
    apple: { enabled: true, auth: 'authenticated' }, qq: { enabled: true, auth: 'authenticated' }, netease: { enabled: true, auth: 'authenticated' },
  } })
  useSettingsStore.setState({ ...initialSettings, lyricsAmllFallback: true, lyricsKugouFallback: true })
  useGameModeStore.setState({ enabled: false })
  useLyricsSourceStore.setState({ sourceOrder: null, health: {}, probes: {}, defaultSource: 'auto', remembered: {}, candidates: [], candidateToken: null, candidateTrackKey: null, appliedOrigin: null, requestedOrigin: 'auto', fallbackReason: null, appliedPreference: 'auto' })
})
afterEach(() => { stop?.(); stop = undefined; vi.restoreAllMocks(); vi.unstubAllGlobals() })

async function open(token = 'dialog-1') {
  await action('queryCandidates', 'apple:a1', token)
  await flush()
}

describe('歌词来源：宿主命令到正式快照', () => {
  it('候选预览不改变正式歌词；手选原子切换、偏移归零并记住，丢弃晚到补全', async () => {
    let upgrade!: (value: LyricsResult) => void
    h.upgrade.mockReturnValueOnce(new Promise< LyricsResult>(done => { upgrade = done }))
    stop = initLyricsLoader()
    await flush()
    const shown = useLyricsStore.getState().lines
    await open()
    expect(useLyricsStore.getState().lines).toBe(shown)
    expect(useLyricsSourceStore.getState().candidates.every(row => row.status === 'ready')).toBe(true)
    useLyricsStore.getState().setOffsetSec(.5)
    expect(await action('chooseSource', 'apple:a1', 'dialog-1', 'qq', true)).toEqual({ saved: true, offsetReset: true })
    expect(useLyricsStore.getState()).toMatchObject({ lines: result('qq').main, translation: result('qq').aligned, offsetSec: 0, currentIndex: 1 })
    expect(useLyricsSourceStore.getState()).toMatchObject({ requestedOrigin: 'qq', appliedOrigin: 'qq', remembered: { 'apple:a1': { origin: 'qq' } } })
    upgrade(result('amll'))
    await flush()
    expect(useLyricsSourceStore.getState().appliedOrigin).toBe('qq')
    const stored = archive.get(LYRICS_SOURCE_STORAGE_KEY)!
    expect(stored).not.toContain('secret-url')
    expect(stored).not.toContain('secret-cookie')
    const snapshot = takePlaybackSnapshot(true)
    expect(snapshot.stores.lyricSources).toMatchObject({ appliedOrigin: 'qq' })
    expect(snapshot.stores.lyricSources.candidates).toHaveLength(5)
    expect(JSON.stringify(snapshot.stores.lyricSources.candidates)).not.toContain('wordLines')
  })

  it('切歌后恢复按歌记忆；仅本次覆盖保留旧记录；重启从宿主存档恢复', async () => {
    stop = initLyricsLoader()
    await flush()
    await open()
    await action('chooseSource', 'apple:a1', 'dialog-1', 'qq', true)
    await action('chooseSource', 'apple:a1', 'dialog-1', 'netease', false)
    expect(useLyricsSourceStore.getState().remembered['apple:a1'].origin).toBe('qq')
    expect(useLyricsSourceStore.getState().appliedOrigin).toBe('netease')
    usePlayerStore.setState({ currentTrack: { ...track, id: 'a2' } })
    await flush()
    expect(useLyricsSourceStore.getState().appliedOrigin).toBe('apple')
    usePlayerStore.setState({ currentTrack: track })
    await flush()
    expect(useLyricsSourceStore.getState().appliedOrigin).toBe('qq')
    stop()
    stop = undefined
    useLyricsSourceStore.setState({ remembered: {}, defaultSource: 'auto' })
    loadLyricsSourcePreferences()
    useLyricsSourceStore.setState({ sourceOrder: null })
    stop = initLyricsLoader()
    await flush()
    expect(useLyricsSourceStore.getState().appliedOrigin).toBe('qq')
    expect(h.upgrade).toHaveBeenCalledTimes(2)
  })

  it('修改全局偏好不改变当前曲目，自动模式可主动应用新规则', async () => {
    stop = initLyricsLoader()
    await flush()
    await action('setDefaultSource', 'amll')
    expect(useLyricsSourceStore.getState()).toMatchObject({ defaultSource: 'amll', appliedPreference: 'auto', appliedOrigin: 'apple' })
    await open()
    await action('chooseSource', 'apple:a1', 'dialog-1', 'auto', true)
    await flush()
    expect(useLyricsSourceStore.getState()).toMatchObject({ appliedOrigin: 'amll', requestedOrigin: 'auto', appliedPreference: 'amll' })
    usePlayerStore.setState({ currentTrack: { ...track, id: 'a2' } })
    await flush()
    expect(useLyricsSourceStore.getState().appliedOrigin).toBe('amll')
  })

  it('全局偏好修改后，同曲补详情和歌词开关重同步仍使用本次规则', async () => {
    stop = initLyricsLoader()
    await flush()
    await action('setDefaultSource', 'amll')
    usePlayerStore.setState({ currentTrack: { ...track, catalogId: 'detail' } })
    await flush()
    useSettingsStore.getState().setLyricsKugouFallback(false)
    await flush()
    expect(useLyricsSourceStore.getState()).toMatchObject({ appliedOrigin: 'apple', appliedPreference: 'auto', defaultSource: 'amll' })
    expect(h.query).not.toHaveBeenCalled()
    usePlayerStore.setState({ currentTrack: { ...track, id: 'a2' } })
    await flush()
    expect(useLyricsSourceStore.getState().appliedOrigin).toBe('amll')
  })

  it('恢复自动失败保留原歌词与已记住来源，不虚报恢复成功', async () => {
    stop = initLyricsLoader()
    await flush()
    await open()
    await action('chooseSource', 'apple:a1', 'dialog-1', 'qq', true)
    const shown = useLyricsStore.getState().lines
    h.fetch.mockResolvedValue({ ...result('apple'), main: [] })
    await expect(action('chooseSource', 'apple:a1', 'dialog-1', 'auto', true)).rejects.toThrow('原歌词')
    expect(useLyricsStore.getState().lines).toBe(shown)
    expect(useLyricsSourceStore.getState()).toMatchObject({ appliedOrigin: 'qq', requestedOrigin: 'qq', remembered: { 'apple:a1': { origin: 'qq' } } })
  })

  it('恢复自动途中关闭，晚到结果不能清除记忆或应用新歌词', async () => {
    stop = initLyricsLoader()
    await flush()
    await open()
    await action('chooseSource', 'apple:a1', 'dialog-1', 'qq', true)
    let finish!: (value: LyricsResult) => void
    h.fetch.mockReturnValueOnce(new Promise<LyricsResult>(done => { finish = done }))
    const request = action('chooseSource', 'apple:a1', 'dialog-1', 'auto', true)
    await action('cancelSelection', 'dialog-1')
    finish(result('apple'))
    await expect(request).rejects.toThrow('取消')
    expect(useLyricsSourceStore.getState()).toMatchObject({ appliedOrigin: 'qq', remembered: { 'apple:a1': { origin: 'qq' } } })
  })

  it('记住来源不可用时按全局偏好回退，保留记忆且不再跨来源升级', async () => {
    useLyricsSourceStore.setState({ defaultSource: 'netease', remembered: { 'apple:a1': { origin: 'qq', name: track.name, artist: track.artist } } })
    h.query.mockImplementation(async (_track: Track, origin: LyricOrigin) => origin === 'qq'
      ? { status: 'error', message: '暂时连接失败' } : { status: 'ready', result: result(origin) })
    stop = initLyricsLoader()
    await flush()
    expect(useLyricsSourceStore.getState()).toMatchObject({ requestedOrigin: 'qq', appliedOrigin: 'netease', remembered: { 'apple:a1': { origin: 'qq' } } })
    expect(useLyricsSourceStore.getState().fallbackReason).toContain('暂时连接失败')
    expect(h.upgrade).not.toHaveBeenCalled()
  })

  it('关闭面板取消尚未完成的提交与候选，不写失败记忆', async () => {
    stop = initLyricsLoader()
    await flush()
    const pending = deferred()
    h.query.mockImplementation((_track: Track, origin: LyricOrigin) => origin === 'qq' ? pending.promise : Promise.resolve({ status: 'ready', result: result(origin) }))
    await action('queryCandidates', 'apple:a1', 'dialog-1')
    const choice = action('chooseSource', 'apple:a1', 'dialog-1', 'qq', true)
    await action('cancelSelection', 'dialog-1')
    pending.resolve({ status: 'ready', result: result('qq') })
    await expect(choice).rejects.toThrow('取消')
    await flush()
    expect(useLyricsSourceStore.getState()).toMatchObject({ appliedOrigin: 'apple', remembered: {}, candidates: [], candidateToken: null })
  })

  it('宿主 cancel 命令与主窗口断开动作都能取消歌词事务，不停止正常歌词', async () => {
    stop = initLyricsLoader()
    await flush()
    const pending = deferred()
    h.query.mockImplementation((_track: Track, origin: LyricOrigin) => origin === 'qq' ? pending.promise : Promise.resolve({ status: 'ready', result: result(origin) }))
    await action('queryCandidates', 'apple:a1', 'dialog-1')
    const request = handlePlaybackRequest({ type: 'action', store: 'lyricSources', action: 'chooseSource', args: ['apple:a1', 'dialog-1', 'qq', true], requestId: 'lyric-choice-1' })
    await handlePlaybackRequest({ type: 'cancel', requestId: 'lyric-choice-1' })
    pending.resolve({ status: 'ready', result: result('qq') })
    await expect(request).rejects.toThrow('取消')
    expect(useLyricsSourceStore.getState()).toMatchObject({ appliedOrigin: 'apple', remembered: {}, candidateToken: null })
    await open('dialog-2')
    await handlePlaybackRequest({ type: 'action', store: 'controls', action: 'cancelLyricsSelection', args: [] })
    expect(useLyricsSourceStore.getState().candidateToken).toBeNull()
    expect(useLyricsStore.getState().lines).toEqual(result('apple').main)
  })

  it.each(['切歌', '账号交换', '停用来源'])('%s后旧候选和提交不能覆盖正式结果', async (reason) => {
    stop = initLyricsLoader()
    await flush()
    const pending = deferred()
    h.query.mockImplementation((_track: Track, origin: LyricOrigin) => origin === 'qq' ? pending.promise : Promise.resolve({ status: 'ready', result: result(origin) }))
    await action('queryCandidates', 'apple:a1', 'dialog-1')
    const choice = action('chooseSource', 'apple:a1', 'dialog-1', 'qq', true)
    if (reason === '切歌') usePlayerStore.setState({ currentTrack: { ...track, id: 'a2' } })
    else if (reason === '账号交换') advanceProviderAccountSession('qq')
    else {
      h.available.mockImplementation((_track: Track, origin: LyricOrigin) => origin === 'qq' ? { status: 'disabled', message: '已停用' } : { status: 'idle' })
      useProviderStore.getState().setEnabled('qq', false)
    }
    pending.resolve({ status: 'ready', result: result('qq') })
    await expect(choice).rejects.toThrow('取消')
    await flush()
    expect(useLyricsSourceStore.getState().appliedOrigin).not.toBe('qq')
    expect(useLyricsSourceStore.getState().remembered).toEqual({})
  })

  it('请求受两个并发限制，关闭面板不再启动排队的来源请求', async () => {
    stop = initLyricsLoader()
    await flush()
    h.query.mockReset().mockImplementation(() => new Promise(() => {}))
    await action('queryCandidates', 'apple:a1', 'dialog-1')
    // 当前 Apple 结果已缓存，不重复查询；其余来源同时最多两项。
    expect(h.query).toHaveBeenCalledTimes(2)
    await action('cancelSelection', 'dialog-1')
    await flush()
    expect(h.query).toHaveBeenCalledTimes(2)
  })

  it('记忆写入失败仍切换当前歌词，不虚报保存；清除全部不突变当前选择', async () => {
    stop = initLyricsLoader()
    await flush()
    await open()
    vi.spyOn(localStorage, 'setItem').mockImplementationOnce(() => { throw new Error('quota') })
    expect(await action('chooseSource', 'apple:a1', 'dialog-1', 'qq', true)).toEqual({ saved: false, offsetReset: false })
    expect(useLyricsSourceStore.getState()).toMatchObject({ appliedOrigin: 'qq', remembered: {} })
    await action('chooseSource', 'apple:a1', 'dialog-1', 'qq', true)
    await action('clearRemembered')
    usePlayerStore.setState({ currentTrack: { ...track, catalogId: 'detail' } })
    await flush()
    expect(useLyricsSourceStore.getState()).toMatchObject({ appliedOrigin: 'qq', remembered: {} })
  })

  it('仅允许已声明的来源和有边界的会话参数，旧面板不能撤销新面板', async () => {
    stop = initLyricsLoader()
    await flush()
    await open()
    await open('dialog-2')
    await action('cancelSelection', 'dialog-1')
    expect(useLyricsSourceStore.getState().candidateToken).toBe('dialog-2')
    await expect(action('chooseSource', 'apple:a1', 'dialog-2', 'unsafe', true)).rejects.toThrow('无效')
    await expect(action('queryCandidates', 'apple:a1', 'x'.repeat(161))).rejects.toThrow('无效')
  })
})


describe('四来源完整顺序', () => {
  const onlineTrack: Track = { ...track, source: 'netease', provider: 'netease', id: 'n1' }
  beforeEach(() => {
    usePlayerStore.setState({ currentTrack: onlineTrack })
    useLyricsSourceStore.setState({ sourceOrder: ['qq', 'amll', 'kugou', 'netease'] })
  })

  it('依完整顺序回退，取得歌词即停止且不被低优先补全覆盖', async () => {
    h.query.mockImplementation(async (_track: Track, origin: LyricOrigin) => origin === 'kugou'
      ? { status: 'ready', result: result(origin) } : origin === 'netease' ? new Promise(() => {}) : { status: 'empty', message: '未收录' })
    stop = initLyricsLoader()
    await flush()
    // 并发探测全部来源，前面都未收录时落定到酷狗，并取消排在其后的网易。
    expect(h.query.mock.calls.map(call => call[1])).toEqual(['qq', 'amll', 'kugou', 'netease'])
    expect((h.query.mock.calls[3][3] as AbortSignal).aborted).toBe(true)
    expect(useLyricsSourceStore.getState().appliedOrigin).toBe('kugou')
    expect(h.fetch).not.toHaveBeenCalled()
    expect(h.upgrade).not.toHaveBeenCalled()
  })

  it('歌曲记忆优先于完整顺序，失败后保留记忆并依次回退', async () => {
    useLyricsSourceStore.setState({ remembered: { 'netease:n1': { origin: 'netease', name: track.name, artist: track.artist } } })
    h.query.mockImplementation(async (_track: Track, origin: LyricOrigin) => origin === 'netease'
      ? { status: 'error', message: '连接失败' } : { status: 'ready', result: result(origin) })
    stop = initLyricsLoader()
    await flush()
    expect(h.query.mock.calls.map(call => call[1])).toEqual(['netease', 'qq', 'amll', 'kugou'])
    expect(useLyricsSourceStore.getState()).toMatchObject({ appliedOrigin: 'qq', requestedOrigin: 'netease', remembered: { 'netease:n1': { origin: 'netease' } } })
    expect(useLyricsSourceStore.getState().fallbackReason).toContain('连接失败')
  })

  it('宿主顺序动作同步快照，当前歌曲稳定、下一首应用新顺序', async () => {
    stop = initLyricsLoader()
    await flush()
    expect(useLyricsSourceStore.getState().appliedOrigin).toBe('qq')
    await action('setSourceOrder', ['amll', 'kugou', 'netease', 'qq'])
    expect(takePlaybackSnapshot(true).stores.lyricSources.sourceOrder).toEqual(['amll', 'kugou', 'netease', 'qq'])
    expect(useLyricsSourceStore.getState().appliedOrigin).toBe('qq')
    usePlayerStore.setState({ currentTrack: { ...onlineTrack, id: 'n2' } })
    await flush()
    expect(useLyricsSourceStore.getState().appliedOrigin).toBe('amll')
    expect(h.upgrade).not.toHaveBeenCalled()
  })

  it('启用并测试旧停用来源只更新测试快照，不重载当前歌词或歌曲记忆', async () => {
    useSettingsStore.setState({ lyricsAmllFallback: false })
    useLyricsSourceStore.setState({ remembered: { 'netease:n1': { origin: 'qq', name: track.name, artist: track.artist } } })
    stop = initLyricsLoader()
    await flush()
    const shown = useLyricsStore.getState().lines
    const current = useLyricsSourceStore.getState()
    const remembered = current.remembered
    expect(current).toMatchObject({ appliedOrigin: 'qq', requestedOrigin: 'qq' })
    const initial = h.query.mock.calls.length

    const pending = deferred()
    h.query.mockReturnValueOnce(pending.promise)
    useSettingsStore.getState().setLyricsAmllFallback(true)
    await flush()
    expect(h.query).toHaveBeenCalledTimes(initial)
    await action('testSource', 'amll', 'sunny')
    expect(h.query).toHaveBeenCalledTimes(initial + 1)
    expect(h.query).toHaveBeenLastCalledWith(
      expect.objectContaining({ source: 'netease', name: '晴天' }), 'amll', ['netease', 'qq'],
      expect.any(AbortSignal), undefined, { probe: true },
    )
    expect(takePlaybackSnapshot(true).stores.lyricSources.probes).toMatchObject({ amll: { status: 'loading', sample: '晴天' } })
    expect(useLyricsStore.getState().lines).toBe(shown)

    pending.resolve({ status: 'ready', result: result('amll') })
    await flush()
    const snapshot = takePlaybackSnapshot(true).stores.lyricSources
    expect(snapshot.probes).toMatchObject({ amll: { status: 'ready', sample: '晴天', ms: expect.any(Number) } })
    expect(snapshot).toMatchObject({ appliedOrigin: 'qq', requestedOrigin: 'qq', remembered })
    expect(useLyricsSourceStore.getState().remembered).toBe(remembered)
    expect(useLyricsStore.getState().lines).toBe(shown)
    expect(h.query).toHaveBeenCalledTimes(initial + 1)
  })

  it('宿主可以忘记单首记忆，不影响当前歌词及其他歌曲', async () => {
    useLyricsSourceStore.setState({ remembered: {
      'netease:n1': { origin: 'amll', name: track.name, artist: track.artist },
      'netease:n2': { origin: 'qq', name: '另一首', artist: track.artist },
    } })
    stop = initLyricsLoader()
    await flush()
    const shown = useLyricsStore.getState().lines
    await action('forgetTrack', 'netease:n1')
    expect(useLyricsStore.getState().lines).toBe(shown)
    expect(useLyricsSourceStore.getState().remembered).toEqual({ 'netease:n2': { origin: 'qq', name: '另一首', artist: track.artist } })
  })
})


describe('并发探测与下一首预取', () => {
  const onlineTrack: Track = { ...track, source: 'netease', provider: 'netease', id: 'n1' }
  const nextTrack: Track = { ...onlineTrack, id: 'n2', name: '下一首' }
  const initialPlaylist = usePlaylistStore.getState()
  beforeEach(() => {
    vi.useFakeTimers()
    usePlayerStore.setState({ currentTrack: onlineTrack })
    useLyricsSourceStore.setState({ sourceOrder: ['qq', 'amll', 'kugou', 'netease'] })
  })
  afterEach(() => {
    stop?.()
    stop = undefined
    usePlaylistStore.setState(initialPlaylist)
    vi.useRealTimers()
  })

  it('高优先级未结束时等待；超过 1.5 秒先显示已到达的歌词，高优先级就绪后替换一次', async () => {
    const qq = deferred()
    h.query.mockImplementation((_track: Track, origin: LyricOrigin) => origin === 'qq' ? qq.promise
      : origin === 'amll' ? Promise.resolve({ status: 'ready', result: result(origin) }) : new Promise(() => {}))
    stop = initLyricsLoader()
    await flush()
    expect(useLyricsStore.getState()).toMatchObject({ loading: true, lines: [] })
    await vi.advanceTimersByTimeAsync(1500)
    expect(useLyricsSourceStore.getState().appliedOrigin).toBe('amll')
    qq.resolve({ status: 'ready', result: result('qq') })
    await flush()
    expect(useLyricsSourceStore.getState().appliedOrigin).toBe('qq')
    expect(useLyricsStore.getState().lines).toEqual(result('qq').main)
  })

  it('兜底显示的来源最终胜出时不重复提交，保留用户已调的偏移', async () => {
    const qq = deferred()
    h.query.mockImplementation((_track: Track, origin: LyricOrigin) => origin === 'qq' ? qq.promise
      : origin === 'amll' ? Promise.resolve({ status: 'ready', result: result(origin) }) : new Promise(() => {}))
    stop = initLyricsLoader()
    await flush()
    await vi.advanceTimersByTimeAsync(1500)
    useLyricsStore.getState().setOffsetSec(.5)
    qq.resolve({ status: 'empty', message: '未收录' } as never)
    await flush()
    expect(useLyricsSourceStore.getState().appliedOrigin).toBe('amll')
    expect(useLyricsStore.getState().offsetSec).toBe(.5)
  })

  it('当前歌词落定后串行预取下一首，切到下一首直接使用缓存', async () => {
    usePlaylistStore.setState({ queue: [onlineTrack, nextTrack], queueIndex: 0, shuffleOrder: [] })
    useSettingsStore.setState({ playMode: 'order' })
    h.query.mockImplementation(async (_track: Track, origin: LyricOrigin) => origin === 'amll'
      ? { status: 'ready', result: result(origin) } : { status: 'empty', message: '未收录' })
    stop = initLyricsLoader()
    await flush()
    const before = h.query.mock.calls.length
    await vi.advanceTimersByTimeAsync(1000)
    await flush()
    // 预取逐个查询，命中 AMLL 即停，不再查酷狗和网易。
    expect(h.query.mock.calls.slice(before).map(call => [(call[0] as Track).id, call[1]])).toEqual([['n2', 'qq'], ['n2', 'amll']])
    const prefetched = h.query.mock.calls.length
    usePlayerStore.setState({ currentTrack: nextTrack })
    await flush()
    expect(h.query).toHaveBeenCalledTimes(prefetched)
    expect(useLyricsSourceStore.getState().appliedOrigin).toBe('amll')
  })

  it('前序来源连接失败的降级结果不进缓存，切到该曲时重新探测', async () => {
    usePlaylistStore.setState({ queue: [onlineTrack, nextTrack], queueIndex: 0, shuffleOrder: [] })
    useSettingsStore.setState({ playMode: 'order' })
    h.query.mockImplementation(async (current: Track, origin: LyricOrigin) => current.id === 'n2' && origin === 'qq'
      ? { status: 'error', message: '暂时连接失败' } : { status: 'ready', result: result(origin) })
    stop = initLyricsLoader()
    await flush()
    await vi.advanceTimersByTimeAsync(1000)
    await flush()
    const before = h.query.mock.calls.length
    usePlayerStore.setState({ currentTrack: nextTrack })
    await flush()
    expect(h.query.mock.calls.slice(before).map(call => call[1])).toContain('qq')
  })

  it.each(['当前播放', '下一首预取'] as const)('%s跳过冷却来源的结果不长期缓存，恢复后重新探测', async (mode) => {
    const target = mode === '当前播放' ? onlineTrack : nextTrack
    usePlaylistStore.setState({ queue: mode === '下一首预取' ? [onlineTrack, nextTrack] : [], queueIndex: mode === '下一首预取' ? 0 : -1, shuffleOrder: [] })
    useSettingsStore.setState({ playMode: 'order' })
    for (let i = 0; i < 3; i++) reportLyricsSource('qq', 'error')
    h.query.mockImplementation(async (_track: Track, origin: LyricOrigin) => suspendedLyricsSource(origin)
      ? { status: 'unavailable', message: '来源连接异常，稍后自动重试' } : { status: 'ready', result: result(origin) })
    stop = initLyricsLoader()
    await flush()
    if (mode === '下一首预取') await vi.advanceTimersByTimeAsync(1000)
    const count = () => h.query.mock.calls.filter(call => (call[0] as Track).id === target.id && call[1] === 'qq').length
    const before = count()
    if (mode === '当前播放') {
      usePlayerStore.setState({ currentTrack: nextTrack })
      await flush()
    }
    usePlayerStore.setState({ currentTrack: target })
    await flush()
    expect(count()).toBeGreaterThan(before)
    expect(useLyricsSourceStore.getState().appliedOrigin).toBe('amll')
    usePlaylistStore.setState({ queue: [], queueIndex: -1 })
    if (mode === '当前播放') await vi.advanceTimersByTimeAsync(30_000)
    else reportLyricsSource('qq', 'ready', true)
    usePlayerStore.setState({ currentTrack: { ...onlineTrack, id: 'n3' } })
    await flush()
    usePlayerStore.setState({ currentTrack: target })
    await flush()
    expect(useLyricsSourceStore.getState().appliedOrigin).toBe('qq')
  })

  it('缓存来源随后进入冷却时不再直接应用旧缓存', async () => {
    usePlaylistStore.setState({ queue: [], queueIndex: -1 })
    h.query.mockImplementation(async (_track: Track, origin: LyricOrigin) => suspendedLyricsSource(origin)
      ? { status: 'unavailable', message: '来源连接异常，稍后自动重试' } : { status: 'ready', result: result(origin) })
    stop = initLyricsLoader()
    await flush()
    expect(useLyricsSourceStore.getState().appliedOrigin).toBe('qq')
    for (let i = 0; i < 3; i++) reportLyricsSource('qq', 'error')
    usePlayerStore.setState({ currentTrack: nextTrack })
    await flush()
    usePlayerStore.setState({ currentTrack: onlineTrack })
    await flush()
    expect(useLyricsSourceStore.getState().appliedOrigin).toBe('amll')
  })

  it.each([undefined, 120_000])('同曲时长从 %s 补为完整详情后重新选择歌词', async (duration) => {
    usePlaylistStore.setState({ queue: [], queueIndex: -1 })
    usePlayerStore.setState({ currentTrack: { ...onlineTrack, duration } })
    h.query.mockImplementation(async (current: Track, origin: LyricOrigin) => origin === 'qq' && current.duration !== onlineTrack.duration
      ? { status: duration ? 'mismatch' : 'unavailable', message: '无法匹配版本' } : { status: 'ready', result: result(origin) })
    stop = initLyricsLoader()
    await flush()
    expect(useLyricsSourceStore.getState().appliedOrigin).toBe('amll')
    usePlayerStore.setState({ currentTrack: onlineTrack })
    await flush()
    expect(useLyricsSourceStore.getState().appliedOrigin).toBe('qq')
  })

  it.each(['缓存', '在途'] as const)('下一首补详情后不复用旧元数据的%s预取', async (mode) => {
    const incomplete = { ...nextTrack, artist: '旧歌手' }
    const pending = deferred()
    const stale = { ...result('qq'), main: [{ time: 0, text: '旧歌手歌词' }] }
    usePlaylistStore.setState({ queue: [onlineTrack, incomplete], queueIndex: 0, shuffleOrder: [] })
    useSettingsStore.setState({ playMode: 'order' })
    h.query.mockImplementation((current: Track, origin: LyricOrigin) => current.id === nextTrack.id && current.artist === incomplete.artist && origin === 'qq'
      ? mode === '在途' ? pending.promise : Promise.resolve({ status: 'ready', result: stale })
      : Promise.resolve({ status: 'ready', result: result(origin) }))
    stop = initLyricsLoader()
    await flush()
    await vi.advanceTimersByTimeAsync(1000)
    const oldQuery = h.query.mock.calls.find(call => (call[0] as Track).id === nextTrack.id)!
    usePlaylistStore.setState({ queue: [onlineTrack, nextTrack], queueIndex: 1 })
    usePlayerStore.setState({ currentTrack: nextTrack })
    await flush()
    if (mode === '在途') {
      expect((oldQuery[3] as AbortSignal).aborted).toBe(true)
      pending.resolve({ status: 'ready', result: stale })
      await flush()
    }
    expect(h.query.mock.calls.some(call => (call[0] as Track).id === nextTrack.id && (call[0] as Track).artist === nextTrack.artist && call[1] === 'qq')).toBe(true)
    expect(useLyricsStore.getState().lines).toEqual(result('qq').main)
  })

  it('切到预取以外的歌时取消进行中的预取', async () => {
    const other: Track = { ...onlineTrack, id: 'n3' }
    usePlaylistStore.setState({ queue: [onlineTrack, nextTrack, other], queueIndex: 0, shuffleOrder: [] })
    useSettingsStore.setState({ playMode: 'order' })
    h.query.mockImplementation((current: Track, origin: LyricOrigin) => current.id === 'n2'
      ? new Promise(() => {}) : Promise.resolve({ status: 'ready', result: result(origin) }))
    stop = initLyricsLoader()
    await flush()
    await vi.advanceTimersByTimeAsync(1000)
    const prefetch = h.query.mock.calls.find(call => (call[0] as Track).id === 'n2')!
    usePlayerStore.setState({ currentTrack: other })
    await flush()
    expect((prefetch[3] as AbortSignal).aborted).toBe(true)
  })

  it('切到预取中的下一首时接手已发出的查询并并发补齐其余来源', async () => {
    usePlaylistStore.setState({ queue: [onlineTrack, nextTrack], queueIndex: 0, shuffleOrder: [] })
    useSettingsStore.setState({ playMode: 'order' })
    const pendingQQ = deferred()
    h.query.mockImplementation((current: Track, origin: LyricOrigin) => current.id === 'n2' && origin === 'qq'
      ? pendingQQ.promise : Promise.resolve({ status: 'empty', message: '未收录' }))
    stop = initLyricsLoader()
    await flush()
    await vi.advanceTimersByTimeAsync(1000)
    const before = h.query.mock.calls.length
    usePlayerStore.setState({ currentTrack: nextTrack })
    await flush()
    expect(h.query.mock.calls.slice(before).map(call => call[1])).toEqual(['amll', 'kugou', 'netease'])
    pendingQQ.resolve({ status: 'ready', result: result('qq') })
    await flush()
    expect(useLyricsSourceStore.getState().appliedOrigin).toBe('qq')
  })
})
