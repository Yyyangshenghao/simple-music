import { describe, it, expect } from 'vitest'
import { pushTerm, removeTerm, MAX_HISTORY } from './search-history'

describe('pushTerm', () => {
  it('新词插到最前', () => {
    expect(pushTerm(['a', 'b'], 'c')).toEqual(['c', 'a', 'b'])
  })

  it('重复词去重并置顶', () => {
    expect(pushTerm(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c'])
  })

  it('首尾空白裁剪后入库,空词忽略', () => {
    expect(pushTerm(['a'], '  b  ')).toEqual(['b', 'a'])
    expect(pushTerm(['a'], '   ')).toEqual(['a'])
  })

  it('超上限截断到 MAX_HISTORY', () => {
    const full = Array.from({ length: MAX_HISTORY }, (_, i) => `t${i}`)
    const next = pushTerm(full, 'new')
    expect(next).toHaveLength(MAX_HISTORY)
    expect(next[0]).toBe('new')
    expect(next).not.toContain(`t${MAX_HISTORY - 1}`)
  })
})

describe('removeTerm', () => {
  it('删除指定词,不存在时原样返回', () => {
    expect(removeTerm(['a', 'b'], 'a')).toEqual(['b'])
    expect(removeTerm(['a', 'b'], 'x')).toEqual(['a', 'b'])
  })
})
