import { afterEach, describe, it, expect, vi } from 'vitest'
import { pushTerm, removeTerm, loadSearchHistory, saveSearchHistory, MAX_HISTORY } from './search-history'

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

  it('连续搜索只保留最近 10 条，重复搜索置顶且不占额外名额', () => {
    let history: string[] = []
    for (let i = 0; i < 20; i++) history = pushTerm(history, `t${i}`)
    expect(history).toEqual(['t19', 't18', 't17', 't16', 't15', 't14', 't13', 't12', 't11', 't10'])
    expect(pushTerm(history, 't10')).toEqual(['t10', 't19', 't18', 't17', 't16', 't15', 't14', 't13', 't12', 't11'])
  })
})

describe('removeTerm', () => {
  it('删除指定词,不存在时原样返回', () => {
    expect(removeTerm(['a', 'b'], 'a')).toEqual(['b'])
    expect(removeTerm(['a', 'b'], 'x')).toEqual(['a', 'b'])
  })
})

describe('搜索历史持久化上限', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('读取旧版超量历史时只返回最近 10 条', () => {
    const history = Array.from({ length: 15 }, (_, i) => `t${i}`)
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify(history) })
    expect(loadSearchHistory()).toEqual(['t0', 't1', 't2', 't3', 't4', 't5', 't6', 't7', 't8', 't9'])
  })

  it('保存超量历史时只存最近 10 条，清空后保存空列表', () => {
    const setItem = vi.fn()
    vi.stubGlobal('localStorage', { setItem })
    saveSearchHistory(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k'])
    expect(setItem).toHaveBeenLastCalledWith('simplemusic-search-history', JSON.stringify(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']))
    saveSearchHistory([])
    expect(setItem).toHaveBeenLastCalledWith('simplemusic-search-history', '[]')
  })
})
