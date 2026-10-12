import { isValidPermutation, queueDisplayOrder } from './queue-display'
import type { PlayMode, Track } from '../types/domain'

export interface QueueState {
  queue: Track[]
  queueIndex: number
  /** 来源歌单/专辑的播放语境，供听歌上报使用。 */
  queueContextId: unknown
  /** 队列下标排列；长度失配时由走序懒重建。 */
  shuffleOrder: number[]
}

type QueueOrderState = Pick<QueueState, 'queue' | 'queueIndex' | 'shuffleOrder'>
type QueueAppend = Pick<QueueState, 'queue' | 'shuffleOrder'>

/** Fisher-Yates 洗牌出 [0, n) 的随机排列。 */
function shuffledIndices(n: number): number[] {
  const order = Array.from({ length: n }, (_, i) => i)
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  return order
}

/** 只建立队列；选曲和起播由调用方决定。 */
export function createQueueState(queue: Track[], queueContextId: unknown = null): QueueState {
  return { queue, queueIndex: -1, queueContextId, shuffleOrder: shuffledIndices(queue.length) }
}

/** 单曲追加沿用原有行为，允许重复歌曲，不重新洗牌已有顺序。 */
export function appendQueueTrack(state: QueueOrderState, track: Track): QueueAppend {
  return {
    queue: [...state.queue, track],
    shuffleOrder: state.shuffleOrder.length === state.queue.length
      ? [...state.shuffleOrder, state.queue.length]
      : shuffledIndices(state.queue.length + 1),
  }
}

/** 平台参与判断由调用方完成；批量追加按来源与 ID 去重。 */
export function appendQueueTracks(state: QueueOrderState, tracks: Track[]): QueueAppend | null {
  const known = new Set(state.queue.map((track) => `${track.source}:${String(track.id)}`))
  const incoming = tracks.filter((track) => {
    const key = `${track.source}:${String(track.id)}`
    if (known.has(key) || track.playable === false) return false
    known.add(key)
    return true
  })
  if (!incoming.length) return null
  return {
    queue: [...state.queue, ...incoming],
    shuffleOrder: isValidPermutation(state.shuffleOrder, state.queue.length)
      ? [...state.shuffleOrder, ...incoming.map((_, index) => state.queue.length + index)]
      : shuffledIndices(state.queue.length + incoming.length),
  }
}

/** 计算手动上下首目标，不修改当前下标；也用于相邻曲目预加载。 */
export function getQueueStep(
  state: QueueOrderState,
  playMode: PlayMode,
  direction: 1 | -1
): { index: number; shuffleOrder: number[] } {
  const length = state.queue.length
  if (!length) return { index: -1, shuffleOrder: state.shuffleOrder }
  if (playMode !== 'shuffle') {
    return { index: (state.queueIndex + direction + length) % length, shuffleOrder: state.shuffleOrder }
  }
  const shuffleOrder = state.shuffleOrder.length === length ? state.shuffleOrder : shuffledIndices(length)
  const position = shuffleOrder.indexOf(state.queueIndex)
  return { index: shuffleOrder[(position + direction + length) % length], shuffleOrder }
}

/** 显示位置移动；随机模式只调整走序，普通模式重排队列并保留当前曲目。 */
export function moveQueueTrack(
  state: QueueOrderState,
  from: number,
  to: number,
  playMode: PlayMode
): QueueOrderState | null {
  const length = state.queue.length
  if (!Number.isInteger(from) || !Number.isInteger(to)
    || from < 0 || from >= length || to < 0 || to >= length || from === to) return null

  if (playMode === 'shuffle') {
    const order = queueDisplayOrder(length, state.queueIndex, state.shuffleOrder, 'shuffle').indices
    order.splice(to, 0, order.splice(from, 1)[0])
    return { queue: state.queue, queueIndex: state.queueIndex, shuffleOrder: order }
  }
  const indices = Array.from({ length }, (_, index) => index)
  indices.splice(to, 0, indices.splice(from, 1)[0])
  const nextIndex = new Map(indices.map((oldIndex, index) => [oldIndex, index]))
  return {
    queue: indices.map((index) => state.queue[index]),
    queueIndex: nextIndex.get(state.queueIndex) ?? -1,
    shuffleOrder: isValidPermutation(state.shuffleOrder, length)
      ? state.shuffleOrder.map((index) => nextIndex.get(index)!)
      : [],
  }
}

/** index 是原队列下标；单曲循环时不安排下一首。 */
export function moveQueueTrackNext(state: QueueOrderState, index: number, playMode: PlayMode): QueueOrderState | null {
  if (playMode === 'one') return null
  if (!Number.isInteger(index) || index < 0 || index >= state.queue.length || index === state.queueIndex) return null
  const display = queueDisplayOrder(state.queue.length, state.queueIndex, state.shuffleOrder, playMode)
  const from = display.indices.indexOf(index)
  const current = display.currentDisplayIndex
  if (from < 0 || current < 0) return null
  const to = current === state.queue.length - 1 ? 0 : from < current ? current : current + 1
  return moveQueueTrack(state, from, to, playMode)
}

/** 不移除当前曲目，保留其他编辑操作后的播放目标与随机顺序。 */
export function removeQueueTrack(state: QueueOrderState, index: number): QueueOrderState | null {
  if (!Number.isInteger(index) || index < 0 || index >= state.queue.length || index === state.queueIndex) return null
  return {
    queue: state.queue.filter((_, itemIndex) => itemIndex !== index),
    queueIndex: state.queueIndex > index ? state.queueIndex - 1 : state.queueIndex,
    shuffleOrder: isValidPermutation(state.shuffleOrder, state.queue.length)
      ? state.shuffleOrder.filter((itemIndex) => itemIndex !== index).map((itemIndex) => itemIndex > index ? itemIndex - 1 : itemIndex)
      : [],
  }
}
