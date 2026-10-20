import { describe, expect, it } from 'vitest'
import { nextProgressiveCount, PROGRESSIVE_BATCH } from './useProgressiveCount'

describe('分批渲染数量', () => {
  it('每次追加一批，不超过总数', () => {
    expect(nextProgressiveCount(PROGRESSIVE_BATCH, 200)).toBe(PROGRESSIVE_BATCH * 2)
    expect(nextProgressiveCount(PROGRESSIVE_BATCH, 60)).toBe(60)
  })

  it('列表变短后从新总数继续计算', () => {
    expect(nextProgressiveCount(144, 50, 48)).toBe(50)
    expect(nextProgressiveCount(144, 100, 48)).toBe(100)
  })
})
