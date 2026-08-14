import type { PlayMode } from '../types/domain'

export interface QueueDisplayOrder {
  indices: number[]
  currentDisplayIndex: number
}

function isValidPermutation(order: number[], length: number): boolean {
  return order.length === length
    && new Set(order).size === length
    && order.every((index) => Number.isInteger(index) && index >= 0 && index < length)
}

/** 队列面板使用与 next/prev 相同的洗牌排列，同时保留点击行所需的原队列下标。 */
export function queueDisplayOrder(
  length: number,
  queueIndex: number,
  shuffleOrder: number[],
  playMode: PlayMode
): QueueDisplayOrder {
  const natural = Array.from({ length }, (_, index) => index)
  const indices = playMode === 'shuffle' && isValidPermutation(shuffleOrder, length)
    ? [...shuffleOrder]
    : natural
  return {
    indices,
    currentDisplayIndex: indices.indexOf(queueIndex),
  }
}
