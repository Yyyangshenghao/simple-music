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
import { advanceProviderAccountSession } from './provider-account-session'

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
  // 以下用例校验账号参与语义；游客歌词来源在单独的用例里打开。
  useSettingsStore.setState({ lyricsGuestSources: { netease: false, qq: false } })
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
  useLyricsSourceStore.setState({ defaultSource: 'auto', remembered: {}, candidates: [], candidateToken: null, candidateTrackKey: null, appliedOrigin: null, requestedOrigin: 'auto', fallbackReason: null, appliedPreference: 'auto' })
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

  it('全局偏好修改后，同曲补详情和连接设置重同步仍使用本次规则', async () => {
    stop = initLyricsLoader()
    await flush()
    await action('setDefaultSource', 'amll')
    usePlayerStore.setState({ currentTrack: { ...track, catalogId: 'detail' } })
    await flush()
    useSettingsStore.getState().setLyricsAmllHost('github')
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
