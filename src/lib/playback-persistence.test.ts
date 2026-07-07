import { describe, it, expect, beforeEach, vi } from 'vitest'
import { savePlayback, restorePlayback } from './playback-persistence'
import { usePlaylistStore } from '../stores/playlist'
import { usePlayerStore } from '../stores/player'
import type { Track } from '../types/domain'

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
    usePlaylistStore.setState({ queue: [], queueIndex: -1, shuffleOrder: [] })
    usePlayerStore.setState({ currentTrack: null, status: 'idle', position: 0, volume: 0.8 })
  })

  it('存取回路:队列/下标/进度/音量恢复,状态为暂停,URL 被剥离', () => {
    const queue = [makeTrack(0), makeTrack(1, { url: 'http://expired' }), makeTrack(2)]
    usePlaylistStore.setState({ queue, queueIndex: 1 })
    usePlayerStore.setState({ position: 42.5, volume: 0.6 })
    savePlayback()

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
  })

  it('损坏数据与越界下标:不崩溃,不污染队列', () => {
    store['simplemusic-playback'] = 'not json'
    restorePlayback()
    expect(usePlaylistStore.getState().queue.length).toBe(0)

    store['simplemusic-playback'] = JSON.stringify({ queue: [makeTrack(0)], queueIndex: 9, position: 1, volume: 0.5 })
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
    const saved = JSON.parse(store['simplemusic-playback']) as { queue: Track[] }
    expect(saved.queue[0].pending).toBe(true)
    expect(saved.queue[0].mid).toBe('abc') // QQ 播放必需字段保留
    expect(saved.queue[0].album).toBeUndefined()
  })
})
