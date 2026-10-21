import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Track } from '../types/domain'
import type { LyricsResult } from './lyrics-fetch'
import { useLyricsStore } from '../stores/lyrics'
import { usePlayerStore } from '../stores/player'
import { useProviderStore } from '../stores/providers'
import { useGameModeStore } from '../stores/game-mode'
import { useVisualStore } from '../stores/visual'
import { advanceProviderAccountSession } from './provider-account-session'
import { useSettingsStore } from '../stores/settings'

const h = vi.hoisted(() => ({ fetch: vi.fn(), upgrade: vi.fn() }))
vi.mock('./lyrics-fetch', () => ({ fetchLyrics: h.fetch, upgradeLyricsWithAmll: h.upgrade, emptyLyrics: { source: null, main: [], aligned: [], roma: [], wordLines: [] } }))
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
  vi.clearAllMocks()
  h.fetch.mockReset().mockResolvedValue(result)
  h.upgrade.mockReset().mockResolvedValue(null)
  // 归属类用例不关心逐字来源，默认关掉估算；估算单独覆盖
  useSettingsStore.setState({ lyricsEstimateWords: false })
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
    expect(h.fetch).toHaveBeenCalledWith(apple, ['apple', 'qq'], expect.any(AbortSignal))
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

  it('关闭歌词来源清除旧词和来源，排除已停用平台', async () => {
    stopLoader = initLyricsLoader()
    await flush()
    h.fetch.mockResolvedValueOnce({ ...result, source: null, main: [] })
    useProviderStore.getState().setEnabled('qq', false)
    await flush()
    expect(h.fetch).toHaveBeenLastCalledWith(apple, ['apple'], expect.any(AbortSignal))
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
    expect(h.fetch).toHaveBeenLastCalledWith(resolved, ['apple', 'qq'], expect.any(AbortSignal))
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
    expect(h.fetch).toHaveBeenLastCalledWith(full, ['apple', 'qq'], expect.any(AbortSignal))
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

describe('估算逐字与 AMLL 升级', () => {
  it('没有逐字时序时显示估算逐字并标注来源；关闭开关就地回到逐行', async () => {
    useSettingsStore.setState({ lyricsEstimateWords: true })
    stopLoader = initLyricsLoader()
    await flush()
    const state = useLyricsStore.getState()
    expect(state.wordSource).toBe('estimate')
    expect(state.wordLines.map((line) => line.words.map((w) => w.text).join(''))).toEqual(['第一句', '第二句'])
    expect(state.lines).toBe(result.main)
    useSettingsStore.setState({ lyricsEstimateWords: false })
    expect(useLyricsStore.getState()).toMatchObject({ wordSource: null, wordLines: [] })
    expect(h.fetch).toHaveBeenCalledOnce()
  })

  it('估算不挡 AMLL 升级：仍按原始结果去补全，补到后替换估算', async () => {
    useSettingsStore.setState({ lyricsEstimateWords: true })
    const upgraded: LyricsResult = { ...result, wordLines: [{ time: 10, durationMs: 1000, words: [{ text: '第一句', startMs: 0, durationMs: 1000 }] }], wordSource: 'amll' }
    h.upgrade.mockResolvedValue(upgraded)
    stopLoader = initLyricsLoader()
    await flush()
    expect(h.upgrade).toHaveBeenCalledWith(apple, result, expect.any(AbortSignal))
    expect(useLyricsStore.getState()).toMatchObject({ wordSource: 'amll', wordLines: upgraded.wordLines })
  })

  it('升级到达前用户已调整的歌词偏移被保留', async () => {
    let finish!: (value: LyricsResult) => void
    h.upgrade.mockReturnValue(new Promise((resolve) => { finish = resolve }))
    stopLoader = initLyricsLoader()
    await flush()
    useLyricsStore.getState().setOffsetSec(0.5)
    finish({ ...result, wordLines: [{ time: 10, durationMs: 1000, words: [{ text: '第一句', startMs: 0, durationMs: 1000 }] }], wordSource: 'amll' })
    await flush()
    expect(useLyricsStore.getState()).toMatchObject({ wordSource: 'amll', offsetSec: 0.5 })
  })
})

