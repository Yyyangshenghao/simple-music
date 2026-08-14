import { describe, expect, it } from 'vitest'
import { queueDisplayOrder } from './queue-display'

describe('queueDisplayOrder', () => {
  it('随机模式按实际洗牌排列展示并定位当前曲目', () => {
    expect(queueDisplayOrder(4, 1, [2, 0, 3, 1], 'shuffle')).toEqual({
      indices: [2, 0, 3, 1],
      currentDisplayIndex: 3,
    })
  })

  it('普通模式或失效排列回退完整原队列', () => {
    expect(queueDisplayOrder(4, 2, [3, 1], 'shuffle')).toEqual({
      indices: [0, 1, 2, 3],
      currentDisplayIndex: 2,
    })
    expect(queueDisplayOrder(3, 1, [2, 0, 1], 'order').indices).toEqual([0, 1, 2])
  })
})
