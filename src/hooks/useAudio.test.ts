import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  tick: vi.fn(),
  lyricPosition: 0,
  cleanup: undefined as (() => void) | undefined,
}))

vi.mock('react', () => ({
  useEffect: (effect: () => () => void) => { harness.cleanup = effect() },
}))
vi.mock('../stores/player', async () => {
  const { create } = await import('zustand')
  return { usePlayerStore: create(() => ({
    status: 'idle',
    position: 0,
    currentTrack: null,
    playbackTransport: null,
    _lyricPosition: () => harness.lyricPosition,
  })) }
})
vi.mock('../stores/lyrics', async () => {
  const { useLyricsStore } = await vi.importActual<typeof import('../stores/lyrics')>('../stores/lyrics')
  harness.tick.mockImplementation(useLyricsStore.getState().tick)
  useLyricsStore.setState({ tick: harness.tick })
  return { useLyricsStore }
})

import { usePlayerStore } from '../stores/player'
import { useLyricsStore } from '../stores/lyrics'
import { useAudio } from './useAudio'

describe('歌词时钟调度', () => {
  it('纯播放模式不运行歌词时钟，也不订阅播放位置', () => {
    usePlayerStore.setState({ playbackTransport: 'musickit', status: 'playing' })
    useAudio(false, true)
    usePlayerStore.setState({ position: 8 })
    vi.advanceTimersByTime(1000)
    expect(harness.tick).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('游戏桌面歌词降低 MusicKit 时钟频率，并保留行同步', () => {
    usePlayerStore.setState({ playbackTransport: 'musickit', status: 'playing' })
    useAudio(true, true)
    harness.tick.mockClear()
    harness.lyricPosition = 5
    vi.advanceTimersByTime(1000)
    expect(harness.tick).toHaveBeenCalledTimes(4)
    expect(harness.tick).toHaveBeenLastCalledWith(5)
  })
  beforeEach(() => {
    vi.useFakeTimers()
    harness.lyricPosition = 0
    useLyricsStore.getState().setLines([])
    useLyricsStore.getState().setWordLines([])
    harness.tick.mockClear()
    usePlayerStore.setState({ status: 'idle', position: 0, playbackTransport: null, currentTrack: null })
  })

  afterEach(() => {
    harness.cleanup?.()
    harness.cleanup = undefined
    vi.useRealTimers()
  })

  it('普通播放和空闲状态不创建定时器，位置变化仍更新歌词', () => {
    useAudio()
    expect(vi.getTimerCount()).toBe(0)
    usePlayerStore.setState({ playbackTransport: 'online', status: 'playing', position: 3 })
    expect(harness.tick).toHaveBeenLastCalledWith(3)
    expect(vi.getTimerCount()).toBe(0)
    usePlayerStore.setState({ position: 1 })
    expect(harness.tick).toHaveBeenLastCalledWith(1)
  })

  it('MusicKit 播放才运行连续时钟，暂停后停止，恢复时只有一个时钟', () => {
    usePlayerStore.setState({ playbackTransport: 'musickit', status: 'playing' })
    useAudio()
    expect(vi.getTimerCount()).toBe(1)
    harness.lyricPosition = 3.25
    vi.advanceTimersByTime(50)
    expect(harness.tick).toHaveBeenLastCalledWith(3.25)

    usePlayerStore.setState({ status: 'paused' })
    expect(vi.getTimerCount()).toBe(0)
    const calls = harness.tick.mock.calls.length
    vi.advanceTimersByTime(500)
    expect(harness.tick).toHaveBeenCalledTimes(calls)

    usePlayerStore.setState({ status: 'playing' })
    usePlayerStore.setState({ volume: 0.5 })
    expect(vi.getTimerCount()).toBe(1)
    harness.lyricPosition = 4.5
    vi.advanceTimersByTime(50)
    expect(harness.tick).toHaveBeenLastCalledWith(4.5)
  })

  it('暂停时前后拖动立即更新歌词，无需等待时钟', () => {
    usePlayerStore.setState({ playbackTransport: 'musickit', status: 'paused' })
    useAudio()
    harness.lyricPosition = 80
    usePlayerStore.setState({ position: 80 })
    expect(harness.tick).toHaveBeenLastCalledWith(80)
    harness.lyricPosition = 2
    usePlayerStore.setState({ position: 2 })
    expect(harness.tick).toHaveBeenLastCalledWith(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['idle', 'loading'] as const)('MusicKit 进入 %s 时停止连续时钟', status => {
    usePlayerStore.setState({ playbackTransport: 'musickit', status: 'playing' })
    useAudio()
    expect(vi.getTimerCount()).toBe(1)
    usePlayerStore.setState({ status })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('暂停时调整同步偏移立即更新行索引和进度，同值与卸载后不更新', () => {
    useLyricsStore.getState().setLines([{ time: 1, text: '第一行' }, { time: 3, text: '第二行' }])
    useLyricsStore.getState().setWordLines([
      { time: 1, durationMs: 2000, words: [{ text: '第一行', startMs: 0 }] },
      { time: 3, durationMs: 2000, words: [{ text: '第二行', startMs: 0 }] },
    ])
    harness.lyricPosition = 2.5
    usePlayerStore.setState({ playbackTransport: 'musickit', status: 'paused', position: 2.5 })
    useAudio()
    expect(useLyricsStore.getState()).toMatchObject({ currentIndex: 0, currentCharProgress: 0.75 })
    harness.tick.mockClear()
    useLyricsStore.getState().setOffsetSec(1)
    expect(useLyricsStore.getState()).toMatchObject({ currentIndex: 1, currentCharProgress: 0.25 })
    expect(harness.tick).toHaveBeenCalledTimes(1)
    useLyricsStore.getState().setOffsetSec(1)
    expect(harness.tick).toHaveBeenCalledTimes(1)
    useLyricsStore.getState().setOffsetSec(-1)
    expect(useLyricsStore.getState()).toMatchObject({ currentIndex: 0, currentCharProgress: 0.25 })
    expect(harness.tick).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
    harness.cleanup?.()
    useLyricsStore.getState().setOffsetSec(0)
    expect(harness.tick).toHaveBeenCalledTimes(2)
  })

  it('切换传输立即采用对应位置，退出 MusicKit 或卸载时释放时钟', () => {
    usePlayerStore.setState({ playbackTransport: 'online', status: 'playing', position: 8 })
    useAudio()
    harness.lyricPosition = 11.5
    usePlayerStore.setState({ playbackTransport: 'musickit' })
    expect(harness.tick).toHaveBeenLastCalledWith(11.5)
    expect(vi.getTimerCount()).toBe(1)
    usePlayerStore.setState({ playbackTransport: 'offline' })
    expect(harness.tick).toHaveBeenLastCalledWith(8)
    expect(vi.getTimerCount()).toBe(0)
    usePlayerStore.setState({ playbackTransport: 'musickit' })
    harness.cleanup?.()
    expect(vi.getTimerCount()).toBe(0)
    const calls = harness.tick.mock.calls.length
    usePlayerStore.setState({ position: 30 })
    vi.advanceTimersByTime(100)
    expect(harness.tick).toHaveBeenCalledTimes(calls)
  })
})
