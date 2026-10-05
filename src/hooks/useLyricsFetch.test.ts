import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Track } from '../types/domain'
import type { LyricsResult } from '../lib/lyrics-fetch'
import { useLyricsStore } from '../stores/lyrics'

const h = vi.hoisted(() => ({
  player: { currentTrack: null as Track | null, resolvedTrack: null as Track | null, position: 15 },
  providers: { playbackOrder: ['apple', 'qq', 'netease'], byId: {
    apple: { enabled: true, auth: 'authenticated' }, qq: { enabled: true, auth: 'authenticated' }, netease: { enabled: false, auth: 'anonymous' },
  } },
  cleanups: [] as Array<() => void>, fetch: vi.fn(),
}))
vi.mock('react', () => ({ useEffect: (effect: () => (() => void) | undefined) => { const cleanup = effect(); if (cleanup) h.cleanups.push(cleanup) } }))
vi.mock('../stores/player', () => ({ usePlayerStore: Object.assign((selector: (s: typeof h.player) => unknown) => selector(h.player), { getState: () => h.player }) }))
vi.mock('../stores/providers', () => ({ useProviderStore: (selector: (s: typeof h.providers) => unknown) => selector(h.providers) }))
vi.mock('../lib/lyrics-fetch', () => ({ fetchLyrics: h.fetch, emptyLyrics: { source: null, main: [], aligned: [], roma: [], wordLines: [] } }))
import { useLyricsFetch } from './useLyricsFetch'

const apple: Track = { source: 'apple', provider: 'apple', type: 'song', id: 'a1', name: '歌曲', artist: '歌手', artists: [], duration: 180_000 }
const result: LyricsResult = { source: 'qq', main: [{ time: 10, text: '第一句' }, { time: 20, text: '第二句' }], aligned: [], roma: [], wordLines: [] }
const cleanup = () => h.cleanups.splice(0).forEach(fn => fn())
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }

beforeEach(() => {
  vi.clearAllMocks()
  h.player.currentTrack = apple
  h.player.resolvedTrack = null
  h.providers.byId.qq.enabled = true
  h.fetch.mockResolvedValue(result)
  useLyricsStore.setState({ trackKey: null, source: null, loading: false, lines: [], currentIndex: -1 })
})
afterEach(cleanup)

describe('歌词获取与统一展示', () => {
  it('纯播放模式不请求歌词，恢复后按当前曲目重新获取', async () => {
    useLyricsFetch(false)
    await flush()
    expect(h.fetch).not.toHaveBeenCalled()
    expect(useLyricsStore.getState()).toMatchObject({ trackKey: null, loading: false, lines: [] })
    useLyricsFetch(true)
    await flush()
    expect(h.fetch).toHaveBeenCalledOnce()
    expect(useLyricsStore.getState().trackKey).toBe('apple:a1')
  })
  it('把匹配歌词写入Apple曲目归属，立即按当前暂停位置定位行', async () => {
    useLyricsFetch()
    expect(useLyricsStore.getState()).toMatchObject({ loading: true, trackKey: 'apple:a1', source: null })
    await flush()
    expect(h.fetch).toHaveBeenCalledWith(apple, ['apple', 'qq'], expect.any(AbortSignal))
    expect(useLyricsStore.getState()).toMatchObject({ loading: false, trackKey: 'apple:a1', source: 'qq', lines: result.main, currentIndex: 0 })
    expect(h.player.currentTrack).toBe(apple)
  })

  it('快速切歌会取消旧请求，迟到歌词不能覆盖新曲目', async () => {
    let finish!: (value: LyricsResult) => void
    h.fetch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    useLyricsFetch()
    const signal = h.fetch.mock.calls[0][2] as AbortSignal
    cleanup()
    expect(signal.aborted).toBe(true)
    h.player.currentTrack = { ...apple, id: 'a2' }
    h.fetch.mockResolvedValueOnce({ ...result, main: [{ time: 0, text: '新歌词' }] })
    useLyricsFetch()
    await flush()
    finish(result)
    await flush()
    expect(useLyricsStore.getState()).toMatchObject({ trackKey: 'apple:a2', lines: [{ time: 0, text: '新歌词' }] })
  })

  it('关闭歌词来源后清除旧歌词与来源，并排除已停用的平台', async () => {
    useLyricsFetch()
    await flush()
    cleanup()
    h.providers.byId.qq.enabled = false
    h.fetch.mockResolvedValueOnce({ ...result, source: null, main: [] })
    useLyricsFetch()
    await flush()
    expect(h.fetch).toHaveBeenLastCalledWith(apple, ['apple'], expect.any(AbortSignal))
    expect(useLyricsStore.getState()).toMatchObject({ source: null, lines: [], loading: false })
  })
})
