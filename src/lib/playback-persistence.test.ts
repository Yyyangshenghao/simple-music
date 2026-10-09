import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  PLAYBACK_STORAGE_KEY,
  PLAYBACK_STORAGE_SCHEMA,
  savePlayback,
  restorePlayback,
  initPlaybackPersistence,
} from './playback-persistence'
import { usePlaylistStore } from '../stores/playlist'
import { usePlayerStore } from '../stores/player'
import { useShuangeStore } from '../stores/shuange'
import { useProviderStore } from '../stores/providers'
import type { Track } from '../types/domain'
import { api, isLocalApiUrl } from './api'

vi.mock('./service-registry', () => ({
  serviceFor: () => ({
    getDailySongs: () => new Promise(() => {}),
    getRecommendPlaylists: async () => [],
  }),
}))

function makeTrack(i: number, extra: Partial<Track> = {}): Track {
  return {
    provider: 'netease',
    source: 'netease',
    type: 'song',
    id: i,
    name: `t${i}`,
    artist: 'a',
    artists: [],
    duration: 200_000,
    ...extra
  }
}

describe('playback persistence', () => {
  let store: Record<string, string>

  beforeEach(() => {
    store = {}
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v
      },
      removeItem: (k: string) => {
        delete store[k]
      }
    })
    usePlaylistStore.setState({ queue: [], queueIndex: -1, queueContextId: null, shuffleOrder: [] })
    usePlayerStore.setState({ currentTrack: null, status: 'idle', position: 0, volume: 0.8, contextId: null })
    vi.spyOn(usePlayerStore.getState(), 'pause').mockImplementation(() => usePlayerStore.setState({ status: 'paused' }))
    vi.spyOn(usePlayerStore.getState(), 'setVolume').mockImplementation((volume) => usePlayerStore.setState({ volume }))
    vi.spyOn(usePlayerStore.getState(), 'loadTrack').mockImplementation(async (currentTrack, opts) => {
      usePlayerStore.setState({ currentTrack, position: opts?.startAt ?? 0, status: 'loading' })
    })
    useProviderStore.setState({
      byId: { ...useProviderStore.getState().byId, netease: { enabled: true, auth: 'authenticated' } },
      playbackOrder: ['netease'],
    })
  })

  afterEach(async () => {
    if (useShuangeStore.getState().active) useShuangeStore.getState().leave()
    await Promise.resolve()
    usePlaylistStore.getState().clearQueue()
    vi.restoreAllMocks()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it.each(['selected', 'empty', 'unselected'] as const)('刷歌早于首次保存时保留进入前的 %s 队列及断点，音量仍保存最新值', (kind) => {
    const queue = kind === 'empty' ? [] : [makeTrack(0), makeTrack(1), makeTrack(2)]
    const queueIndex = kind === 'selected' ? 1 : -1
    const shuffleOrder = queue.length ? [2, 1, 0] : []
    const position = queueIndex >= 0 ? 20.5 : 0
    usePlaylistStore.setState({ queue, queueIndex, shuffleOrder })
    usePlayerStore.setState({ currentTrack: queue[queueIndex] ?? null, position })
    void useShuangeStore.getState().enter()
    usePlayerStore.setState({ currentTrack: makeTrack(9), contextId: 'shuange:9', position: 95, volume: 0.3 })

    savePlayback()

    expect(JSON.parse(store[PLAYBACK_STORAGE_KEY])).toMatchObject({ queue, queueIndex, shuffleOrder, position, volume: 0.3 })
    usePlayerStore.setState({ currentTrack: null, position: 0 })
    usePlaylistStore.setState({ queue: [], queueIndex: -1, shuffleOrder: [] })
    restorePlayback()
    expect(usePlaylistStore.getState()).toMatchObject({ queue, queueIndex, shuffleOrder })
    expect(usePlayerStore.getState().position).toBe(position)
    expect(usePlayerStore.getState().currentTrack?.id).toBe(queue[queueIndex]?.id)
  })

  it('退出刷歌恢复原队列的随机顺序和断点，并继续正常持久化', async () => {
    const queue = [makeTrack(0), makeTrack(1), makeTrack(2)]
    const shuffleOrder = [2, 0, 1]
    usePlaylistStore.setState({ queue, queueIndex: 1, shuffleOrder })
    usePlayerStore.setState({ currentTrack: queue[1], position: 20.5 })
    void useShuangeStore.getState().enter()
    usePlaylistStore.setState({ shuffleOrder: [1, 2, 0] })
    usePlayerStore.setState({ currentTrack: makeTrack(9), contextId: 'shuange:9', position: 95 })

    useShuangeStore.getState().leave()
    await Promise.resolve()

    expect(usePlaylistStore.getState()).toMatchObject({ queue, queueIndex: 1, shuffleOrder })
    expect(usePlayerStore.getState()).toMatchObject({ currentTrack: queue[1], position: 20.5 })
    usePlayerStore.setState({ position: 25 })
    savePlayback()
    expect(JSON.parse(store[PLAYBACK_STORAGE_KEY])).toMatchObject({ queue, queueIndex: 1, shuffleOrder, position: 25 })
  })

  it('播放整曲接管后保存新队列和整曲进度，不继续使用刷歌前快照', () => {
    const original = makeTrack(0)
    usePlaylistStore.setState({ queue: [original], queueIndex: 0, shuffleOrder: [0] })
    usePlayerStore.setState({ currentTrack: original, position: 20 })
    void useShuangeStore.getState().enter()
    const feed = [makeTrack(9), makeTrack(10)]
    useShuangeStore.setState({ feed, index: 0 })
    usePlayerStore.setState({ currentTrack: feed[0], contextId: 'shuange:9', position: 95 })

    useShuangeStore.getState().playFullCurrent()
    usePlayerStore.setState({ position: 8 })
    savePlayback()

    expect(JSON.parse(store[PLAYBACK_STORAGE_KEY])).toMatchObject({ queue: feed, queueIndex: 0, position: 8 })
  })

  it.each([false, true])('恢复旧会话本地封面时重建端口和 token，配额降级=%s', (compact) => {
    vi.stubGlobal('window', { desktop: { serverPort: 40001, serverToken: 'old-token' } })
    const local = makeTrack(7, { provider: 'local', source: 'local', type: 'local',
      cover: api.url('/api/local/cover', { id: 7 }), url: api.url('/api/local/audio', { id: 7 }) })
    const online = makeTrack(8, { cover: 'https://cdn.example.com/online.jpg' })
    usePlaylistStore.setState({ queue: [local, online], queueIndex: 0 })
    usePlayerStore.setState({ position: 42 })
    if (compact) {
      let attempts = 0
      vi.stubGlobal('localStorage', {
        getItem: (key: string) => store[key] ?? null,
        setItem: (key: string, value: string) => {
          if (++attempts === 1) throw new Error('quota')
          store[key] = value
        },
      })
    }
    savePlayback()
    vi.stubGlobal('window', { desktop: { serverPort: 40002, serverToken: 'new-token' } })
    restorePlayback()
    const restored = usePlayerStore.getState().currentTrack!
    expect(restored.cover).toBe(api.url('/api/local/cover', { id: 7 }))
    expect(isLocalApiUrl(restored.cover!)).toBe(true)
    expect(api.coverImage(restored.cover!)).toBe(restored.cover)
    expect(usePlayerStore.getState()).toMatchObject({ status: 'paused', position: 42 })
    expect(usePlaylistStore.getState().queue[0]).toBe(restored)
    expect(usePlaylistStore.getState().queue[1].cover).toBe(online.cover)
  })

  it('存取回路:队列/下标/进度/音量恢复,状态为暂停,URL 被剥离', () => {
    const queue = [makeTrack(0), makeTrack(1, { url: 'http://expired' }), makeTrack(2)]
    usePlaylistStore.setState({ queue, queueIndex: 1 })
    usePlayerStore.setState({ position: 42.5, volume: 0.6, contextId: 'old-context', currentQuality: '旧音质' })
    savePlayback()
    expect(JSON.parse(store[PLAYBACK_STORAGE_KEY]).schema).toBe(PLAYBACK_STORAGE_SCHEMA)

    usePlaylistStore.setState({ queue: [], queueIndex: -1 })
    usePlayerStore.setState({ currentTrack: null, position: 0, volume: 0.8, status: 'idle' })
    restorePlayback()

    const pl = usePlaylistStore.getState()
    const p = usePlayerStore.getState()
    expect(pl.queue.length).toBe(3)
    expect(pl.queueIndex).toBe(1)
    expect(pl.queue[1].url).toBeUndefined()
    expect(String(p.currentTrack?.id)).toBe('1')
    expect(p.status).toBe('paused')
    expect(p.position).toBe(42.5)
    expect(p.volume).toBe(0.6)
    expect(p.duration).toBe(200) // ms → 秒
    expect(p.contextId).toBeNull()
    expect(p.currentQuality).toBeNull()
  })

  it('恢复随机播放顺序，忽略损坏的顺序', () => {
    const queue = [makeTrack(0), makeTrack(1), makeTrack(2)]
    usePlaylistStore.setState({ queue, queueIndex: 1, shuffleOrder: [2, 1, 0] })
    savePlayback()
    usePlaylistStore.setState({ queue: [], queueIndex: -1, shuffleOrder: [] })
    restorePlayback()
    expect(usePlaylistStore.getState().shuffleOrder).toEqual([2, 1, 0])

    const saved = JSON.parse(store[PLAYBACK_STORAGE_KEY])
    saved.shuffleOrder = [0, 0, 2]
    store[PLAYBACK_STORAGE_KEY] = JSON.stringify(saved)
    restorePlayback()
    expect(usePlaylistStore.getState().shuffleOrder).toEqual([])
  })

  it('仅追加但尚未播放的队列重启后仍保留，不自动选曲或起播', () => {
    const queue = [makeTrack(0), makeTrack(1)]
    usePlaylistStore.setState({ queue, queueIndex: -1, shuffleOrder: [1, 0] })
    savePlayback()
    usePlaylistStore.setState({ queue: [], queueIndex: -1, shuffleOrder: [] })

    restorePlayback()

    expect(usePlaylistStore.getState()).toMatchObject({ queue, queueIndex: -1, shuffleOrder: [1, 0] })
    expect(usePlayerStore.getState()).toMatchObject({ currentTrack: null, status: 'idle' })
  })

  it('损坏数据与越界下标:不崩溃,不污染队列', () => {
    store[PLAYBACK_STORAGE_KEY] = 'not json'
    restorePlayback()
    expect(usePlaylistStore.getState().queue.length).toBe(0)

    store[PLAYBACK_STORAGE_KEY] = JSON.stringify({ queue: [makeTrack(0)], queueIndex: 9, position: 1, volume: 0.5 })
    restorePlayback()
    expect(usePlaylistStore.getState().queue.length).toBe(0)
    expect(usePlayerStore.getState().volume).toBe(0.5) // 音量仍恢复
  })

  it('超配额降级为占位曲目', () => {
    const queue = [makeTrack(0, { mid: 'abc', cover: 'c.jpg', album: '大专辑', fee: 1 })]
    usePlaylistStore.setState({ queue, queueIndex: 0 })
    let calls = 0
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        calls++
        if (calls === 1) throw new Error('QuotaExceededError')
        store[k] = v
      }
    })
    savePlayback()
    const saved = JSON.parse(store[PLAYBACK_STORAGE_KEY]) as { queue: Track[] }
    expect(saved.queue[0].pending).toBe(true)
    expect(saved.queue[0].mid).toBe('abc') // QQ 播放必需字段保留
    expect(saved.queue[0].album).toBeUndefined()
  })

  it('仅更新进度时复用队列序列化，替换队列后保存最新详情和随机顺序', () => {
    const track = makeTrack(0)
    const readName = vi.fn(() => '原曲目')
    Object.defineProperty(track, 'name', { enumerable: true, get: readName })
    usePlaylistStore.setState({ queue: [track, makeTrack(1)], queueIndex: 0, shuffleOrder: [1, 0] })
    savePlayback()
    const initialReads = readName.mock.calls.length
    expect(initialReads).toBeGreaterThan(0)

    usePlayerStore.setState({ position: 25.5, volume: 0.3 })
    savePlayback()
    expect(readName.mock.calls.length).toBe(initialReads)
    expect(JSON.parse(store[PLAYBACK_STORAGE_KEY])).toMatchObject({
      position: 25.5, volume: 0.3, queueIndex: 0, shuffleOrder: [1, 0]
    })

    usePlaylistStore.setState({ queue: [makeTrack(2, { name: '最新详情', url: 'expired' })], queueIndex: 0 })
    savePlayback()
    const saved = JSON.parse(store[PLAYBACK_STORAGE_KEY])
    expect(saved.queue[0].name).toBe('最新详情')
    expect(saved.queue[0].url).toBeUndefined()
    expect(saved.shuffleOrder).toBeUndefined()
  })

  it('占位保存失败时不抛出，之后仍能保存新队列', () => {
    vi.stubGlobal('localStorage', { setItem: () => { throw new Error('quota') } })
    usePlaylistStore.setState({ queue: [makeTrack(0)], queueIndex: 0 })
    expect(() => savePlayback()).not.toThrow()
    vi.stubGlobal('localStorage', { setItem: (k: string, v: string) => { store[k] = v } })
    usePlaylistStore.setState({ queue: [makeTrack(1)], queueIndex: 0 })
    savePlayback()
    expect(JSON.parse(store[PLAYBACK_STORAGE_KEY]).queue[0].id).toBe(1)
  })

  it('兼容 1.x 无 schema 的混合队列，并保留当前曲目来源', () => {
    const queue = [
      makeTrack(0),
      makeTrack(1, { provider: 'qq', source: 'qq', mid: 'qq-mid' }),
      makeTrack(2, { provider: 'local', source: 'local', url: '/tmp/local.mp3' }),
    ]
    store[PLAYBACK_STORAGE_KEY] = JSON.stringify({ queue, queueIndex: 1, position: 8, volume: 0.7 })

    restorePlayback()

    expect(usePlaylistStore.getState().queue.map((track) => track.source)).toEqual(['netease', 'qq', 'local'])
    expect(usePlayerStore.getState().currentTrack?.source).toBe('qq')
    expect(usePlayerStore.getState().actualSource).toBeNull()
    expect(usePlayerStore.getState().status).toBe('paused')
  })

  it('过滤损坏条目时仍按原始下标定位当前曲目，未知 schema 不恢复', () => {
    const current = makeTrack(2, { provider: 'qq', source: 'qq' })
    store[PLAYBACK_STORAGE_KEY] = JSON.stringify({
      schema: PLAYBACK_STORAGE_SCHEMA,
      queue: [{ source: 'broken' }, current],
      queueIndex: 1,
      position: 3,
      volume: 0.4,
    })
    restorePlayback()
    expect(usePlaylistStore.getState().queue).toEqual([current])
    expect(usePlaylistStore.getState().queueIndex).toBe(0)

    usePlaylistStore.setState({ queue: [], queueIndex: -1 })
    usePlayerStore.setState({ currentTrack: null, status: 'idle' })
    store[PLAYBACK_STORAGE_KEY] = JSON.stringify({
      schema: 99,
      queue: [makeTrack(3)],
      queueIndex: 0,
      volume: 0.1,
    })
    restorePlayback()
    expect(usePlaylistStore.getState().queue).toEqual([])
    expect(usePlayerStore.getState().currentTrack).toBeNull()
  })

  it('刷歌期间节流写入及卸载保存使用原断点，同时保留最新音量', () => {
    vi.useFakeTimers()
    const listeners = new Map<string, () => void>()
    vi.stubGlobal('window', { addEventListener: (name: string, callback: () => void) => listeners.set(name, callback) })
    initPlaybackPersistence()
    const queue = [makeTrack(0)]
    usePlaylistStore.setState({ queue, queueIndex: 0, shuffleOrder: [0] })
    usePlayerStore.setState({ currentTrack: queue[0], position: 20, status: 'playing' })
    void useShuangeStore.getState().enter()
    usePlayerStore.setState({ currentTrack: makeTrack(9), contextId: 'shuange:9', position: 95 })
    vi.advanceTimersByTime(500)
    expect(JSON.parse(store[PLAYBACK_STORAGE_KEY])).toMatchObject({ queue, position: 20 })

    usePlayerStore.setState({ position: 110, volume: 0.4 })
    vi.advanceTimersByTime(800)
    expect(JSON.parse(store[PLAYBACK_STORAGE_KEY])).toMatchObject({ position: 20, volume: 0.4 })
    usePlayerStore.setState({ position: 120 })
    vi.advanceTimersByTime(5000)
    expect(JSON.parse(store[PLAYBACK_STORAGE_KEY]).position).toBe(20)
    listeners.get('beforeunload')!()
    expect(JSON.parse(store[PLAYBACK_STORAGE_KEY]).position).toBe(20)
  })
})
