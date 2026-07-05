import { describe, expect, it } from 'vitest'
import { createPool, needsRefill, redeal, refill, swipeTop } from './stack-pool'

const ids = (arr: { id: number }[]) => arr.map((x) => x.id)
const items = (...ns: number[]) => ns.map((id) => ({ id }))

describe('createPool', () => {
  it('前 handSize 个进手牌（第一项是顶卡=末位），其余进池子', () => {
    const pool = createPool(items(1, 2, 3, 4, 5, 6, 7), 5)
    // 渲染顺序：后渲染者在上层，所以 hand 末位是顶卡；items[0] 应当是顶卡
    expect(ids(pool.hand)).toEqual([5, 4, 3, 2, 1])
    expect(ids(pool.reserve)).toEqual([6, 7])
    expect(pool.discarded).toEqual([])
  })

  it('数量不足 handSize 时全部进手牌', () => {
    const pool = createPool(items(1, 2), 5)
    expect(ids(pool.hand)).toEqual([2, 1])
    expect(pool.reserve).toEqual([])
  })
})

describe('swipeTop', () => {
  it('顶卡移到 discarded，池子补一张到堆底（hand 开头）', () => {
    const pool = createPool(items(1, 2, 3, 4, 5, 6, 7), 5)
    const next = swipeTop(pool)
    expect(ids(next.hand)).toEqual([6, 5, 4, 3, 2])
    expect(ids(next.reserve)).toEqual([7])
    expect(ids(next.discarded)).toEqual([1])
  })

  it('池子耗尽时从最早甩出的卡回收', () => {
    let pool = createPool(items(1, 2, 3), 3) // reserve 空
    pool = swipeTop(pool) // 甩 1 → 无卡可补，discarded=[1] 直接回收 1
    expect(ids(pool.hand)).toEqual([1, 3, 2])
    expect(pool.discarded).toEqual([])
  })

  it('空手牌是 no-op', () => {
    const empty = { hand: [], reserve: [], discarded: [] }
    expect(swipeTop(empty)).toBe(empty)
  })
})

describe('redeal', () => {
  it('整手弃掉，从池子抽 handSize 张新手牌（先抽者是顶卡=末位）', () => {
    const pool = createPool(items(1, 2, 3, 4, 5, 6, 7, 8), 3) // hand=[3,2,1] reserve=[4..8]
    const next = redeal(pool, 3)
    expect(ids(next.hand)).toEqual([6, 5, 4])
    expect(ids(next.reserve)).toEqual([7, 8])
    expect(ids(next.discarded)).toEqual([1, 2, 3]) // 顶卡 1 先弃，与 swipeTop 弃序一致
  })

  it('池子不足时回收最早弃掉的卡补齐', () => {
    let pool = createPool(items(1, 2, 3, 4), 3) // hand=[3,2,1] reserve=[4]
    pool = swipeTop(pool) // 弃 1，补 4 → hand=[4,3,2] discarded=[1]
    const next = redeal(pool, 3)
    // reserve 空，弃牌堆=[1, 2,3,4(整手弃入)]，抽 1/2/3
    expect(ids(next.hand)).toEqual([3, 2, 1])
    expect(ids(next.discarded)).toEqual([4])
    expect(next.reserve).toEqual([])
  })
})

describe('refill', () => {
  it('按 id 对 hand+reserve+discarded 全量去重后追加到池子', () => {
    let pool = createPool(items(1, 2, 3, 4, 5, 6), 5)
    pool = swipeTop(pool) // discarded=[1]
    const next = refill(pool, items(1, 3, 6, 8, 9, 8), (x) => x.id)
    expect(ids(next.reserve)).toEqual([8, 9]) // 1/3/6 已存在，8 只进一次
  })

  it('全部重复时原样返回（引用不变，避免无谓重渲染）', () => {
    const pool = createPool(items(1, 2, 3), 3)
    expect(refill(pool, items(1, 2), (x) => x.id)).toBe(pool)
  })
})

describe('needsRefill', () => {
  it('池子余量 <= 阈值时需要补货', () => {
    expect(needsRefill(createPool(items(1, 2, 3, 4, 5, 6, 7), 5))).toBe(true) // reserve=2
    const big = createPool(Array.from({ length: 20 }, (_, i) => ({ id: i })), 5) // reserve=15
    expect(needsRefill(big)).toBe(false)
  })
})
