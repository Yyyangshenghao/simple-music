import { describe, expect, it } from 'vitest'
import {
  appendQueueTrack,
  appendQueueTracks,
  createQueueState,
  getQueueStep,
  moveQueueTrack,
  moveQueueTrackNext,
  removeQueueTrack,
  type QueueState,
} from './queue-state'
import { isValidPermutation } from './queue-display'
import type { MusicSource, Track } from '../types/domain'

function song(id: unknown, source: MusicSource = 'netease'): Track {
  return { provider: source, source, type: 'song', id, name: String(id), artist: '', artists: [] }
}

function frozenState(): QueueState {
  const state: QueueState = {
    queue: [0, 1, 2, 3].map((id) => song(id)),
    queueIndex: 2,
    queueContextId: 'album',
    shuffleOrder: [2, 0, 3, 1],
  }
  Object.freeze(state.queue)
  Object.freeze(state.shuffleOrder)
  return Object.freeze(state)
}

describe('独立播放队列状态', () => {
  it('建立队列时保留曲目和语境，生成随机排列但不自动选曲', () => {
    const queue = [song('A'), song('B')]
    const state = createQueueState(queue, 'playlist')
    expect(state.queue).toBe(queue)
    expect(state.queueIndex).toBe(-1)
    expect(state.queueContextId).toBe('playlist')
    expect(isValidPermutation(state.shuffleOrder, queue.length)).toBe(true)
    expect(createQueueState([])).toEqual({ queue: [], queueIndex: -1, queueContextId: null, shuffleOrder: [] })
  })

  it.each(['order', 'one'] as const)('%s 模式手动上下首仍循环走序，计算不修改播放位置', (mode) => {
    const state = frozenState()
    expect(getQueueStep(state, mode, 1).index).toBe(3)
    expect(getQueueStep({ ...state, queueIndex: 3 }, mode, 1).index).toBe(0)
    expect(getQueueStep({ ...state, queueIndex: 0 }, mode, -1).index).toBe(3)
    expect(state.queueIndex).toBe(2)
    expect(getQueueStep(state, mode, 1).shuffleOrder).toBe(state.shuffleOrder)
  })

  it('空队列没有上下首；随机顺序长度失配时只生成一次新排列', () => {
    const empty = createQueueState([])
    expect(getQueueStep(empty, 'shuffle', 1).index).toBe(-1)
    expect(getQueueStep(empty, 'order', -1).index).toBe(-1)
    let state = { ...frozenState(), shuffleOrder: [] as number[] }
    const visited = [state.queueIndex]
    const first = getQueueStep(state, 'shuffle', 1)
    expect(isValidPermutation(first.shuffleOrder, state.queue.length)).toBe(true)
    state = { ...state, queueIndex: first.index, shuffleOrder: first.shuffleOrder }
    visited.push(state.queueIndex)
    for (let i = 0; i < 2; i++) {
      const step = getQueueStep(state, 'shuffle', 1)
      expect(step.shuffleOrder).toBe(first.shuffleOrder)
      state = { ...state, queueIndex: step.index }
      visited.push(state.queueIndex)
    }
    expect(new Set(visited).size).toBe(4)
    expect(getQueueStep(state, 'shuffle', -1).index).toBe(visited[2])
    expect(getQueueStep(state, 'shuffle', 1).index).toBe(visited[0])
  })

  it('单曲追加允许重复，保留已有随机顺序和播放目标', () => {
    const state = frozenState()
    const update = appendQueueTrack(state, state.queue[2])
    expect(update.queue).toEqual([...state.queue, state.queue[2]])
    expect(update.shuffleOrder).toEqual([2, 0, 3, 1, 4])
    expect({ ...state, ...update }.queueIndex).toBe(2)
    expect(state.queue).toHaveLength(4)
  })

  it('批量追加按来源和字符串 ID 去重，保留不同平台、本地与 Apple 的原始身份', () => {
    const state = frozenState()
    const incoming = [song('2'), song('A', 'qq'), song('A', 'qq'), song('A', 'local'), song('A', 'apple'), { ...song('B'), playable: false }]
    const update = appendQueueTracks(state, incoming)!
    expect(update.queue.slice(4)).toEqual([incoming[1], incoming[3], incoming[4]])
    expect(update.shuffleOrder).toEqual([2, 0, 3, 1, 4, 5, 6])
    expect({ ...state, ...update }).toMatchObject({ queueIndex: 2, queueContextId: 'album' })
    expect(state.queue).toHaveLength(4)
  })

  it('批量追加没有新曲目时不产生状态更新', () => {
    const state = frozenState()
    expect(appendQueueTracks(state, [])).toBeNull()
    expect(appendQueueTracks(state, [song('2'), { ...song('A'), playable: false }])).toBeNull()
  })

  it('追加时为失配的随机顺序重建完整排列', () => {
    const state = { ...frozenState(), shuffleOrder: [] }
    expect(isValidPermutation(appendQueueTrack(state, song(4)).shuffleOrder, 5)).toBe(true)
    expect(isValidPermutation(appendQueueTracks(state, [song(4), song(5)])!.shuffleOrder, 6)).toBe(true)
  })

  it.each(['order', 'one', 'shuffle'] as const)('%s 模式任意重排都保持当前曲目与合法排列', (mode) => {
    const state = frozenState()
    for (let from = 0; from < 4; from++) {
      for (let to = 0; to < 4; to++) {
        const update = moveQueueTrack(state, from, to, mode)
        if (from === to) {
          expect(update).toBeNull()
          continue
        }
        expect(update!.queue[update!.queueIndex]).toBe(state.queue[state.queueIndex])
        expect(isValidPermutation(update!.shuffleOrder, 4)).toBe(true)
        if (mode === 'shuffle') expect(update!.queue).toBe(state.queue)
        else {
          expect(update!.shuffleOrder.map((index) => update!.queue[index]))
            .toEqual(state.shuffleOrder.map((index) => state.queue[index]))
        }
      }
    }
  })

  it('无效移动、移除和单曲循环的下一首安排不产生更新', () => {
    const state = frozenState()
    for (const index of [-1, 4, 1.5, NaN]) {
      expect(moveQueueTrack(state, index, 0, 'order')).toBeNull()
      expect(moveQueueTrack(state, 0, index, 'shuffle')).toBeNull()
      expect(removeQueueTrack(state, index)).toBeNull()
      expect(moveQueueTrackNext(state, index, 'order')).toBeNull()
    }
    expect(removeQueueTrack(state, state.queueIndex)).toBeNull()
    expect(moveQueueTrackNext(state, state.queueIndex, 'shuffle')).toBeNull()
    expect(moveQueueTrackNext(state, 0, 'one')).toBeNull()
  })

  it.each(['order', 'shuffle'] as const)('%s 模式设为下一首覆盖前后位置及末尾回绕，不改变当前曲目', (mode) => {
    const original = frozenState()
    for (let current = 0; current < 4; current++) {
      const state = { ...original, queueIndex: current }
      for (let target = 0; target < 4; target++) {
        if (target === current) continue
        const next = { ...state, ...moveQueueTrackNext(state, target, mode) }
        expect(next.queue[next.queueIndex]).toBe(state.queue[current])
        expect(next.queue[getQueueStep(next, mode, 1).index]).toBe(state.queue[target])
      }
    }
  })

  it('移除任意非当前曲目时保留播放目标与其余曲目的随机走序', () => {
    const state = frozenState()
    for (const index of [0, 1, 3]) {
      const update = removeQueueTrack(state, index)!
      expect(update.queue[update.queueIndex]).toBe(state.queue[state.queueIndex])
      expect(update.queue).not.toContain(state.queue[index])
      expect(isValidPermutation(update.shuffleOrder, 3)).toBe(true)
      expect(update.shuffleOrder.map((item) => update.queue[item]))
        .toEqual(state.shuffleOrder.map((item) => state.queue[item]).filter((track) => track !== state.queue[index]))
    }
  })
})
