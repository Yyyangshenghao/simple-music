import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useLyricsStore } from './lyrics'
import type { WordLyricLine } from '../types/domain'

const wordLine = (time: number, durationMs = 2000): WordLyricLine => ({
  time, durationMs, words: [{ text: '歌词', startMs: 0, durationMs }],
})

describe('歌词定位与逐字进度', () => {
  beforeEach(() => {
    useLyricsStore.getState().setLines([
      { time: 1, text: '第一行' },
      { time: 3, text: '第二行' },
      { time: 3, text: '同时间最后一行' },
      { time: 6, text: '末行' },
    ])
    useLyricsStore.getState().setWordLines([wordLine(1), wordLine(3), wordLine(3), wordLine(6)])
  })

  it('同时间定位到最后一行，支持向前和向后拖动及首尾边界', () => {
    const { tick } = useLyricsStore.getState()
    for (const [position, index] of [[0, -1], [1, 0], [3, 2], [100, 3], [2, 0], [0, -1]]) {
      tick(position)
      expect(useLyricsStore.getState().currentIndex).toBe(index)
    }
  })

  it('正负偏移同时影响行定位和逐字进度', () => {
    const { tick, setOffsetSec } = useLyricsStore.getState()
    setOffsetSec(1)
    tick(2.5)
    expect(useLyricsStore.getState()).toMatchObject({ currentIndex: 2, currentCharProgress: 0.25 })
    setOffsetSec(-1)
    tick(2.5)
    expect(useLyricsStore.getState()).toMatchObject({ currentIndex: 0, currentCharProgress: 0.25 })
  })

  it('一次通知同时包含新行和进度，重复时间和饱和进度不通知', () => {
    const notify = vi.fn()
    const unsubscribe = useLyricsStore.subscribe(notify)
    try {
      useLyricsStore.getState().tick(3.5)
      expect(notify).toHaveBeenCalledTimes(1)
      expect(notify.mock.calls[0][0]).toMatchObject({ currentIndex: 2, currentCharProgress: 0.25 })
      useLyricsStore.getState().tick(3.5)
      expect(notify).toHaveBeenCalledTimes(1)
      useLyricsStore.getState().tick(20)
      notify.mockClear()
      useLyricsStore.getState().tick(21)
      useLyricsStore.getState().tickProgress(21)
      expect(notify).not.toHaveBeenCalled()
    } finally { unsubscribe() }
  })

  it('拖到首行之前或缺少逐字行时清除旧进度', () => {
    const { tick, setWordLines, tickProgress } = useLyricsStore.getState()
    tick(1.5)
    expect(useLyricsStore.getState().currentCharProgress).toBe(0.25)
    tick(0)
    expect(useLyricsStore.getState().currentCharProgress).toBe(0)
    tick(1.5)
    setWordLines([])
    tick(1.5)
    expect(useLyricsStore.getState().currentCharProgress).toBe(0)
    setWordLines([wordLine(1)])
    tick(1.5)
    setWordLines([])
    tickProgress(1.5)
    expect(useLyricsStore.getState().currentCharProgress).toBe(0)
  })

  it('更换歌词清除旧逐字进度，空歌词保持初始定位', () => {
    useLyricsStore.getState().tick(1.5)
    useLyricsStore.getState().setLines([])
    expect(useLyricsStore.getState()).toMatchObject({ currentIndex: -1, currentCharProgress: 0 })
    useLyricsStore.getState().tick(20)
    expect(useLyricsStore.getState()).toMatchObject({ currentIndex: -1, currentCharProgress: 0 })
  })
})
