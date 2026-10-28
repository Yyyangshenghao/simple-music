import { useSettingsStore } from '../stores/settings'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Track } from '../types/domain'
import type { LyricsResult } from './lyrics-fetch'
import { useLyricsStore } from '../stores/lyrics'
import { usePlayerStore } from '../stores/player'
import { useProviderStore } from '../stores/providers'
import { useGameModeStore } from '../stores/game-mode'
import { useVisualStore } from '../stores/visual'
import { advanceProviderAccountSession } from './provider-account-session'
import { useLyricsSourceStore } from '../stores/lyrics-source'

const h = vi.hoisted(() => ({ fetch: vi.fn(), upgrade: vi.fn(), localSource: vi.fn() }))
vi.mock('./lyrics-fetch', () => ({ fetchLyrics: h.fetch, upgradeLyrics: h.upgrade, localLyricSource: h.localSource, emptyLyrics: { source: null, main: [], aligned: [], roma: [], wordLines: [] } }))
import { initLyricsLoader } from './lyrics-loader'

const apple: Track = { source: 'apple', provider: 'apple', type: 'song', id: 'a1', name: '歌曲', artist: '歌手', artists: [], duration: 180_000 }
const result: LyricsResult = { source: 'qq', main: [{ time: 10, text: '第一句' }, { time: 20, text: '第二句' }], aligned: [], roma: [], wordLines: [] }
const initialPlayer = usePlayerStore.getState()
const initialProviders = useProviderStore.getState()
let stopLoader: (() => void) | undefined
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve() }
const deferred = () => {
  let resolve!: (value: LyricsResult) => void
  let reject!: (error: Error) => void
  const promise = new Promise<LyricsResult>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

beforeEach(() => {
  // 与应用默认一致：游客歌词查询开启；关闭的语义在单独的用例里校验。
  useSettingsStore.setState({ lyricsGuestSources: { netease: true, qq: true } })
  vi.clearAllMocks()
  h.fetch.mockReset().mockResolvedValue(result)
  h.upgrade.mockReset().mockResolvedValue(null)
  usePlayerStore.setState({ ...initialPlayer, currentTrack: apple, resolvedTrack: null, position: 15, status: 'paused' })
  useProviderStore.setState({ ...initialProviders, playbackOrder: ['apple', 'qq', 'netease'], byId: {
    apple: { enabled: true, auth: 'authenticated' }, qq: { enabled: true, auth: 'authenticated' }, netease: { enabled: false, auth: 'anonymous' }
  } })
  useGameModeStore.setState({ enabled: false })
  useVisualStore.getState().updateFx({ desktopLyrics: false })
  useLyricsStore.setState({ trackKey: null, source: null, loading: false, lines: [], currentIndex: -1 })
})
afterEach(() => { stopLoader?.(); stopLoader = undefined })

describe('宿主持有歌词获取与归属', () => {
  it('只为已应用歌词记录来源，播放进度不刷日志，升级时记录真实补全来源', async () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => {})
    try {
      const pending = deferred()
      h.upgrade.mockReturnValueOnce(pending.promise)
      stopLoader = initLyricsLoader()
      await flush()
      expect(log).toHaveBeenCalledWith('[lyrics] 歌词来源', {
        trackKey: 'apple:a1', name: '歌曲', source: 'qq', matchedSource: 'qq', upgraded: false,
      })
      usePlayerStore.setState({ position: 25 })
      useLyricsStore.getState().tick(25)
      expect(log).toHaveBeenCalledTimes(1)
      pending.resolve({ ...result, origin: 'kugou' })
      await flush()
      expect(log).toHaveBeenLastCalledWith('[lyrics] 歌词来源', {
        trackKey: 'apple:a1', name: '歌曲', source: 'kugou', matchedSource: 'qq', upgraded: true,
      })
      expect(log).toHaveBeenCalledTimes(2)
    } finally { log.mockRestore() }
  })

  it('空歌词或切歌后迟到的结果不记录来源', async () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => {})
    try {
      const old = deferred()
      h.fetch.mockReturnValueOnce(old.promise)
      stopLoader = initLyricsLoader()
      h.fetch.mockResolvedValueOnce({ ...result, source: null, main: [] })
      usePlayerStore.setState({ currentTrack: { ...apple, id: 'a2' } })
      await flush()
      old.resolve(result)
      await flush()
      expect(log).not.toHaveBeenCalled()
    } finally { log.mockRestore() }
  })

  it('先显示逐行歌词，后台升级时保留偏移，并按当前进度定位', async () => {
    const pending = deferred()
    h.upgrade.mockReturnValueOnce(pending.promise)
    stopLoader = initLyricsLoader()
    await flush()
    expect(useLyricsStore.getState().lines).toBe(result.main)
    useLyricsStore.getState().setOffsetSec(0.4)
    usePlayerStore.setState({ position: 25 })
    pending.resolve({ ...result, wordLines: [{ time: 10, durationMs: 1000, words: [{ text: '第一句', startMs: 0, durationMs: 1000 }] }] })
    await flush()
    expect(useLyricsStore.getState()).toMatchObject({ trackKey: 'apple:a1', offsetSec: 0.4, currentIndex: 1 })
    expect(useLyricsStore.getState().wordLines).toHaveLength(1)
  })

  it('切歌或补全平台账号交换后，迟到的逐字版本不能覆盖新歌词', async () => {
    const pending = deferred()
    h.upgrade.mockReturnValueOnce(pending.promise)
    stopLoader = initLyricsLoader()
    await flush()
    const signal = h.upgrade.mock.calls[0][3] as AbortSignal
    advanceProviderAccountSession('qq')
    pending.resolve({ ...result, main: [{ time: 1, text: '过期逐字' }] })
    await flush()
    expect(useLyricsStore.getState().lines).toBe(result.main)
    usePlayerStore.setState({ currentTrack: { ...apple, id: 'a2' } })
    expect(signal.aborted).toBe(true)
    await flush()
    expect(useLyricsStore.getState().trackKey).toBe('apple:a2')
    expect(useLyricsStore.getState().lines).toBe(result.main)
  })

  it('纯播放模式不请求歌词，恢复后按当前曲目获取', async () => {
    useGameModeStore.setState({ enabled: true })
    stopLoader = initLyricsLoader()
    await flush()
    expect(h.fetch).not.toHaveBeenCalled()
    expect(useLyricsStore.getState()).toMatchObject({ trackKey: null, loading: false, lines: [] })
    useVisualStore.getState().updateFx({ desktopLyrics: true })
    await flush()
    expect(h.fetch).toHaveBeenCalledOnce()
    expect(useLyricsStore.getState().trackKey).toBe('apple:a1')
  })

  it('把匹配歌词归属原Apple曲目，按完成时最新暂停位置定位，重复启动不重取', async () => {
    const pending = deferred()
    h.fetch.mockReturnValueOnce(pending.promise)
    stopLoader = initLyricsLoader()
    expect(initLyricsLoader()).toBe(stopLoader)
    expect(useLyricsStore.getState()).toMatchObject({ loading: true, trackKey: 'apple:a1', source: null })
    usePlayerStore.setState({ position: 25 })
    pending.resolve(result)
    await flush()
    expect(h.fetch).toHaveBeenCalledOnce()
    expect(h.fetch).toHaveBeenCalledWith(apple, ['apple', 'qq', 'netease'], expect.any(AbortSignal))
    expect(useLyricsStore.getState()).toMatchObject({ loading: false, trackKey: 'apple:a1', source: 'qq', lines: result.main, currentIndex: 1 })
    expect(usePlayerStore.getState().currentTrack).toBe(apple)
  })

  it('快速切歌取消旧请求，迟到歌词不能覆盖新曲目', async () => {
    const old = deferred()
    h.fetch.mockReturnValueOnce(old.promise)
    stopLoader = initLyricsLoader()
    const signal = h.fetch.mock.calls[0][2] as AbortSignal
    h.fetch.mockResolvedValueOnce({ ...result, main: [{ time: 0, text: '新歌词' }] })
    usePlayerStore.setState({ currentTrack: { ...apple, id: 'a2' } })
    expect(signal.aborted).toBe(true)
    await flush()
    old.resolve(result)
    await flush()
    expect(useLyricsStore.getState()).toMatchObject({ trackKey: 'apple:a2', lines: [{ time: 0, text: '新歌词' }] })
  })

  it('关闭播放平台不关闭游客歌词查询，按同曲规则重新同步', async () => {
    stopLoader = initLyricsLoader()
    await flush()
    h.fetch.mockResolvedValueOnce({ ...result, source: null, main: [] })
    useProviderStore.getState().setEnabled('qq', false)
    await flush()
    expect(h.fetch).toHaveBeenLastCalledWith(apple, ['apple', 'netease', 'qq'], expect.any(AbortSignal))
    expect(useLyricsStore.getState()).toMatchObject({ source: null, lines: [], loading: false })
  })

  it('同曲实际来源改变也取消旧请求，原曲无词后才读实际来源，保留原归属', async () => {
    const old = deferred()
    h.fetch.mockReturnValueOnce(old.promise)
    stopLoader = initLyricsLoader()
    const oldSignal = h.fetch.mock.calls[0][2] as AbortSignal
    const resolved: Track = { ...apple, provider: 'qq', source: 'qq', id: 'q1' }
    h.fetch.mockImplementation(async (track: Track) => track.source === 'apple' ? { ...result, main: [] } : result)
    usePlayerStore.setState({ resolvedTrack: resolved })
    expect(oldSignal.aborted).toBe(true)
    await flush()
    expect(h.fetch).toHaveBeenLastCalledWith(resolved, ['apple', 'qq', 'netease'], expect.any(AbortSignal))
    old.resolve({ ...result, main: [{ time: 0, text: '旧会话' }] })
    await flush()
    expect(useLyricsStore.getState()).toMatchObject({ trackKey: 'apple:a1', source: 'qq', lines: result.main })
  })

  it('相同来源和ID的原曲/实际曲只尝试一次', async () => {
    usePlayerStore.setState({ resolvedTrack: { ...apple } })
    h.fetch.mockResolvedValue({ ...result, main: [] })
    stopLoader = initLyricsLoader()
    await flush()
    expect(h.fetch).toHaveBeenCalledOnce()
  })

  it('账号交换已开始但store尚未通知时，旧成功数据也不能提交', async () => {
    const old = deferred()
    h.fetch.mockReturnValueOnce(old.promise)
    stopLoader = initLyricsLoader()
    advanceProviderAccountSession('qq')
    old.resolve(result)
    await flush()
    expect(useLyricsStore.getState()).toMatchObject({ loading: false, source: null, lines: [] })
    useProviderStore.getState().setAccountState('qq', 'authenticated', { nickname: '新账号', avatar: '' })
    await flush()
    expect(h.fetch).toHaveBeenCalledTimes(2)
    expect(useLyricsStore.getState()).toMatchObject({ loading: false, source: 'qq', lines: result.main })
  })

  it('相同auth换账号会重取，旧账号迟到结果不能覆盖新账号', async () => {
    const old = deferred()
    h.fetch.mockReturnValueOnce(old.promise)
    stopLoader = initLyricsLoader()
    const oldSignal = h.fetch.mock.calls[0][2] as AbortSignal
    h.fetch.mockResolvedValueOnce({ ...result, main: [{ time: 0, text: '新账号歌词' }] })
    useProviderStore.getState().setAccountState('qq', 'authenticated', { nickname: '新账号', avatar: '' })
    expect(oldSignal.aborted).toBe(true)
    await flush()
    old.resolve(result)
    await flush()
    expect(useLyricsStore.getState().lines).toEqual([{ time: 0, text: '新账号歌词' }])
  })

  it('跳转后重新缓冲写入同身份的新曲目对象，不清空也不重取歌词', async () => {
    stopLoader = initLyricsLoader()
    await flush()
    usePlayerStore.setState({ resolvedTrack: { ...apple } })
    await flush()
    expect(h.fetch).toHaveBeenCalledOnce()
    usePlayerStore.setState({ resolvedTrack: { ...apple }, currentTrack: { ...apple } })
    await flush()
    expect(h.fetch).toHaveBeenCalledOnce()
    expect(useLyricsStore.getState()).toMatchObject({ trackKey: 'apple:a1', loading: false, lines: result.main })
  })

  it.each([false, true])('伴奏往返保留已加载歌词和偏移，跨源播放=%s', async crossSource => {
    const original: Track = { ...apple, source: 'netease', provider: 'netease', id: 'n1' }
    const resolved: Track = crossSource ? { ...original, source: 'qq', provider: 'qq', id: 'q1' } : original
    const stem: Track = { ...original, source: 'local', provider: 'local', id: `karaoke:${'a'.repeat(40)}`, accompanimentOriginal: original }
    h.fetch.mockImplementation(async (track: Track) => crossSource && track.source === 'netease' ? { ...result, main: [] } : result)
    usePlayerStore.setState({ currentTrack: original, resolvedTrack: resolved })
    stopLoader = initLyricsLoader()
    await flush()
    expect(useLyricsStore.getState().lines).toBe(result.main)
    useLyricsStore.setState({ offsetSec: 0.7 })
    const requests = h.fetch.mock.calls.length
    usePlayerStore.setState({ accompaniment: stem, resolvedTrack: null })
    usePlayerStore.setState({ resolvedTrack: stem })
    await flush()
    expect(useLyricsStore.getState()).toMatchObject({ loading: false, lines: result.main, offsetSec: 0.7 })
    usePlayerStore.setState({ accompaniment: null, resolvedTrack: null })
    usePlayerStore.setState({ resolvedTrack: { ...resolved } })
    await flush()
    expect(h.fetch).toHaveBeenCalledTimes(requests)
    expect(useLyricsStore.getState()).toMatchObject({ trackKey: 'netease:n1', loading: false, lines: result.main, offsetSec: 0.7 })
  })

  it('在我的伴奏中直接点播同曲成品时，歌词归属仍跟随独立曲目身份', async () => {
    const original: Track = { ...apple, source: 'netease', provider: 'netease', id: 'n1' }
    const stem: Track = { ...original, source: 'local', provider: 'local', id: `karaoke:${'a'.repeat(40)}`, accompanimentOriginal: original }
    usePlayerStore.setState({ currentTrack: original, resolvedTrack: original })
    stopLoader = initLyricsLoader()
    await flush()
    usePlayerStore.setState({ currentTrack: stem, resolvedTrack: stem })
    await flush()
    expect(useLyricsStore.getState()).toMatchObject({ trackKey: `local:${String(stem.id)}`, lines: result.main })
    usePlayerStore.setState({ currentTrack: original, resolvedTrack: original })
    await flush()
    expect(useLyricsStore.getState()).toMatchObject({ trackKey: 'netease:n1', lines: result.main })
  })

  it('Apple 库占位曲目无词后，同 ID 补齐目录编号会重取歌词', async () => {
    const placeholder = { ...apple, id: 'i.library-1', pending: true }
    usePlayerStore.setState({ currentTrack: placeholder })
    h.fetch.mockImplementation(async (track: Track) => track.catalogId ? result : { ...result, main: [] })
    stopLoader = initLyricsLoader()
    await flush()
    expect(useLyricsStore.getState().lines).toEqual([])
    const full = { ...placeholder, pending: false, catalogId: '123456' }
    usePlayerStore.setState({ currentTrack: full })
    await flush()
    expect(h.fetch).toHaveBeenLastCalledWith(full, ['apple', 'qq', 'netease'], expect.any(AbortSignal))
    expect(useLyricsStore.getState().lines).toEqual(result.main)
    usePlayerStore.setState({ resolvedTrack: { ...full }, currentTrack: { ...full, cover: 'new-cover', url: 'new-url' } })
    await flush()
    expect(h.fetch).toHaveBeenCalledTimes(2)
  })

  it('同 ID 补全歌词匹配信息时取消旧请求，迟到空词不能覆盖新结果', async () => {
    const old = deferred()
    usePlayerStore.setState({ currentTrack: { ...apple, duration: undefined, artists: [] } })
    h.fetch.mockReturnValueOnce(old.promise)
    stopLoader = initLyricsLoader()
    const oldSignal = h.fetch.mock.calls[0][2] as AbortSignal
    usePlayerStore.setState({ currentTrack: { ...apple, artists: [{ id: 'artist', name: '歌手' }], isrc: 'CNTEST12345' } })
    await flush()
    expect(oldSignal.aborted).toBe(true)
    expect(h.fetch).toHaveBeenCalledTimes(2)
    old.resolve({ ...result, main: [] })
    await flush()
    expect(useLyricsStore.getState().lines).toEqual(result.main)
  })

  it('进度、音量及无关偏好不会反复获取歌词', async () => {
    stopLoader = initLyricsLoader()
    await flush()
    usePlayerStore.setState({ position: 30, volume: 0.2, rate: 2 })
    useProviderStore.getState().setSourceBadgeMode('always')
    useVisualStore.getState().updateFx({ desktopLyrics: true, desktopLyricsSize: 22 })
    await flush()
    expect(h.fetch).toHaveBeenCalledOnce()
  })

  it('本地曲目无需在线账号，空曲目清空歌词', async () => {
    useSettingsStore.setState({ lyricsGuestSources: { netease: false, qq: false } })
    const local: Track = { ...apple, provider: 'local', source: 'local', id: 'file1' }
    usePlayerStore.setState({ currentTrack: local })
    useProviderStore.setState({ playbackOrder: [], byId: {
      apple: { enabled: false, auth: 'anonymous' }, qq: { enabled: false, auth: 'anonymous' }, netease: { enabled: false, auth: 'anonymous' }
    } })
    h.fetch.mockResolvedValueOnce({ ...result, source: 'local' })
    stopLoader = initLyricsLoader()
    await flush()
    expect(h.fetch).toHaveBeenCalledWith(local, [], expect.any(AbortSignal))
    expect(useLyricsStore.getState()).toMatchObject({ trackKey: 'local:file1', source: 'local' })
    usePlayerStore.setState({ currentTrack: null })
    expect(useLyricsStore.getState()).toMatchObject({ trackKey: null, loading: false, lines: [] })
  })

  it('本地歌曲不受全局优先来源影响，先用本地歌词', async () => {
    useSettingsStore.setState({ lyricsGuestSources: { netease: false, qq: false } })
    const local: Track = { ...apple, provider: 'local', source: 'local', id: 'file1' }
    const previous = useLyricsSourceStore.getState().defaultSource
    useLyricsSourceStore.setState({ defaultSource: 'qq' })
    try {
      usePlayerStore.setState({ currentTrack: local })
      h.fetch.mockResolvedValueOnce({ ...result, source: 'local' })
      stopLoader = initLyricsLoader()
      await flush()
      expect(h.localSource).not.toHaveBeenCalled()
      expect(h.fetch).toHaveBeenCalledWith(local, ['apple', 'qq'], expect.any(AbortSignal))
      expect(useLyricsStore.getState()).toMatchObject({ trackKey: 'local:file1', source: 'local' })
    } finally { useLyricsSourceStore.setState({ defaultSource: previous }) }
  })

  it('开关游客歌词来源会重新取词，参与平台随之变化', async () => {
    useSettingsStore.setState({ lyricsGuestSources: { netease: false, qq: false } })
    stopLoader = initLyricsLoader()
    await flush()
    expect(h.fetch).toHaveBeenLastCalledWith(apple, ['apple', 'qq'], expect.any(AbortSignal))
    useSettingsStore.getState().setLyricsGuestSource('netease', true)
    await flush()
    expect(h.fetch).toHaveBeenCalledTimes(2)
    expect(h.fetch).toHaveBeenLastCalledWith(apple, ['apple', 'qq', 'netease'], expect.any(AbortSignal))
  })

  it('无关在线账号交换不使本地LRC失效', async () => {
    const pending = deferred()
    usePlayerStore.setState({ currentTrack: { ...apple, source: 'local', provider: 'local', id: 'file1' } })
    h.fetch.mockReturnValueOnce(pending.promise)
    stopLoader = initLyricsLoader()
    advanceProviderAccountSession('qq')
    pending.resolve({ ...result, source: 'local' })
    await flush()
    expect(useLyricsStore.getState()).toMatchObject({ trackKey: 'local:file1', source: 'local', loading: false, lines: result.main })
  })

  it('游戏纯播放会取消并清词，启用桌面歌词重新取词，退出游戏不重复取词', async () => {
    const old = deferred()
    h.fetch.mockReturnValueOnce(old.promise)
    stopLoader = initLyricsLoader()
    const signal = h.fetch.mock.calls[0][2] as AbortSignal
    useGameModeStore.setState({ enabled: true })
    expect(signal.aborted).toBe(true)
    expect(useLyricsStore.getState()).toMatchObject({ trackKey: null, loading: false, lines: [] })
    old.resolve(result)
    await flush()
    expect(useLyricsStore.getState().lines).toEqual([])
    useVisualStore.getState().updateFx({ desktopLyrics: true })
    await flush()
    expect(useLyricsStore.getState().lines).toEqual(result.main)
    useGameModeStore.setState({ enabled: false })
    await flush()
    expect(h.fetch).toHaveBeenCalledTimes(2)
  })

  it('意外拒绝降为空词并结束加载，旧拒绝不清空新曲目', async () => {
    h.fetch.mockRejectedValueOnce(new Error('异常'))
    stopLoader = initLyricsLoader()
    await flush()
    expect(useLyricsStore.getState()).toMatchObject({ loading: false, lines: [], source: null })
    const old = deferred()
    h.fetch.mockReturnValueOnce(old.promise)
    usePlayerStore.setState({ currentTrack: { ...apple, id: 'a2' } })
    usePlayerStore.setState({ currentTrack: { ...apple, id: 'a3' } })
    await flush()
    old.reject(new Error('旧异常'))
    await flush()
    expect(useLyricsStore.getState()).toMatchObject({ trackKey: 'apple:a3', lines: result.main, loading: false })
  })

  it('MusicKit歌词提交按连续时钟位置定位，不以稀疏store进度覆盖', async () => {
    usePlayerStore.setState({ playbackTransport: 'musickit', position: 15, _lyricPosition: () => 25 })
    stopLoader = initLyricsLoader()
    await flush()
    expect(useLyricsStore.getState().currentIndex).toBe(1)
  })

  it('宿主停止取消请求及订阅，迟到结果与后续状态变化无效', async () => {
    const pending = deferred()
    h.fetch.mockReturnValueOnce(pending.promise)
    stopLoader = initLyricsLoader()
    const signal = h.fetch.mock.calls[0][2] as AbortSignal
    stopLoader()
    stopLoader()
    expect(signal.aborted).toBe(true)
    pending.resolve(result)
    usePlayerStore.setState({ currentTrack: { ...apple, id: 'a2' } })
    useProviderStore.getState().setEnabled('qq', false)
    useGameModeStore.setState({ enabled: true })
    useVisualStore.getState().updateFx({ desktopLyrics: true })
    await flush()
    expect(h.fetch).toHaveBeenCalledOnce()
    expect(useLyricsStore.getState()).toMatchObject({ lines: [], trackKey: 'apple:a1' })
  })
})
