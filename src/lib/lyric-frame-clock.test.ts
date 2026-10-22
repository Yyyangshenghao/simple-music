import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'

const h = vi.hoisted(() => {
  type Subscriber = (state: Record<string, unknown>, previous: Record<string, unknown>) => void
  const makeStore = (initial: Record<string, unknown>) => {
    let state = initial
    const subs = new Set<Subscriber>()
    return {
      getState: () => state,
      setState: (patch: Record<string, unknown>) => { const previous = state; state = { ...state, ...patch }; subs.forEach(sub => sub(state, previous)) },
      subscribe: (sub: Subscriber) => { subs.add(sub); return () => subs.delete(sub) },
      count: () => subs.size,
    }
  }
  const clock = { position: 10 }
  const player = makeStore({ status: 'paused', position: 10, currentTrack: { source: 'local' }, playbackTransport: null, _engine: () => clock })
  const lyrics = makeStore({ offsetSec: 0 })
  return { player, lyrics, clock }
})
vi.mock('../stores/player', () => ({ usePlayerStore: h.player }))
vi.mock('../stores/lyrics', () => ({ useLyricsStore: h.lyrics }))

let frames: FrameRequestCallback[] = []
const doc = { hidden: false, listeners: new Set<() => void>(), addEventListener: (_: string, fn: () => void) => doc.listeners.add(fn), removeEventListener: (_: string, fn: () => void) => doc.listeners.delete(fn) }
beforeEach(() => {
  frames = []
  vi.stubGlobal('document', doc)
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => frames.push(fn))
  vi.stubGlobal('cancelAnimationFrame', () => { frames = [] })
  h.player.setState({ status: 'paused' })
  h.lyrics.setState({ offsetSec: 0 })
})
afterEach(() => vi.unstubAllGlobals())
const step = (now: number) => { const pending = frames; frames = []; pending.forEach(fn => fn(now)) }

describe('动态歌词帧时钟', () => {
  it('暂停时立即推送一次且不开循环；播放后逐帧推送，含歌词偏移', async () => {
    const { subscribeLyricFrames } = await import('./lyric-frame-clock')
    const seen: number[] = []
    const stop = subscribeLyricFrames(frame => seen.push(frame.time))
    expect(seen).toEqual([10])
    expect(frames).toHaveLength(0)
    h.lyrics.setState({ offsetSec: 0.5 })
    expect(seen.at(-1)).toBe(10.5)
    h.player.setState({ status: 'playing' })
    h.clock.position = 11
    step(16)
    step(32)
    expect(seen.slice(-2)).toEqual([11.5, 11.5])
    expect(frames).toHaveLength(1)
    stop()
  })

  it('页面隐藏时停帧，可见后恢复；暂停中拖动推送新位置', async () => {
    const { subscribeLyricFrames } = await import('./lyric-frame-clock')
    const seen: { time: number; running: boolean }[] = []
    const stop = subscribeLyricFrames(frame => seen.push(frame))
    h.player.setState({ status: 'playing' })
    doc.hidden = true
    doc.listeners.forEach(fn => fn())
    expect(seen.at(-1)!.running).toBe(false)
    expect(frames).toHaveLength(0)
    doc.hidden = false
    doc.listeners.forEach(fn => fn())
    expect(frames).toHaveLength(1)
    h.player.setState({ status: 'paused' })
    h.clock.position = 30
    h.player.setState({ position: 30 })
    expect(seen.at(-1)!.time).toBe(30)
    stop()
  })

  it('多个订阅共用一个循环，全部退订后解除订阅', async () => {
    const { subscribeLyricFrames } = await import('./lyric-frame-clock')
    h.player.setState({ status: 'playing' })
    const a = vi.fn()
    const b = vi.fn()
    const stopA = subscribeLyricFrames(a)
    const stopB = subscribeLyricFrames(b)
    expect(frames).toHaveLength(1)
    step(16)
    expect(a).toHaveBeenCalledTimes(2)
    expect(b).toHaveBeenCalledTimes(2)
    stopA()
    stopB()
    expect(frames).toHaveLength(0)
    expect(h.player.count()).toBe(0)
    expect(doc.listeners.size).toBe(0)
  })

  it('readLyricFrame 不订阅也能读到当前位置（暂停时样式重写用）', async () => {
    const { readLyricFrame } = await import('./lyric-frame-clock')
    h.clock.position = 42
    h.lyrics.setState({ offsetSec: -2 })
    expect(readLyricFrame()).toMatchObject({ time: 40, running: false })
    expect(frames).toHaveLength(0)
    expect(h.player.count()).toBe(0)
  })
})
