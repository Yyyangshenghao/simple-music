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

  it('超过十条后继续保留，重复搜索置顶且不占额外名额', () => {
    let history: string[] = []
    for (let i = 0; i < 20; i++) history = pushTerm(history, `t${i}`)
    expect(history).toHaveLength(20)
    expect(history[19]).toBe('t0')
    const next = pushTerm(history, 't0')
    expect(next).toHaveLength(20)
    expect(next[0]).toBe('t0')
    expect(next[1]).toBe('t19')
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

  it('兼容已有历史，读取超过 10000 条时保留最近的 10000 条', () => {
    const history = Array.from({ length: 10005 }, (_, i) => `t${i}`)
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify(history) })
    const loaded = loadSearchHistory()
    expect(loaded).toHaveLength(10000)
    expect(loaded[0]).toBe('t0')
    expect(loaded[9999]).toBe('t9999')
  })

  it('保存最多 10000 条，清空后保存空列表', () => {
    const setItem = vi.fn()
    vi.stubGlobal('localStorage', { setItem })
    const history = Array.from({ length: 10005 }, (_, i) => `t${i}`)
    saveSearchHistory(history)
    expect(setItem).toHaveBeenLastCalledWith('simplemusic-search-history', JSON.stringify(history.slice(0, 10000)))
    saveSearchHistory([])
    expect(setItem).toHaveBeenLastCalledWith('simplemusic-search-history', '[]')
  })
})
