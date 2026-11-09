import { describe, expect, it } from 'vitest'
import { applyModeDrop, DEFAULT_QISHUI_PINNED_MODES, normalizeQishuiPinnedModes, QISHUI_MAX_PINNED_MODES } from './qishui-mode-pins'

describe('听歌模式常用区', () => {
  it('无效存档恢复默认，过滤非法项和重复项，超出上限截断', () => {
    expect(normalizeQishuiPinnedModes(null)).toEqual(DEFAULT_QISHUI_PINNED_MODES)
    expect(normalizeQishuiPinnedModes('default')).toEqual(DEFAULT_QISHUI_PINNED_MODES)
    expect(normalizeQishuiPinnedModes([])).toEqual([])
    expect(normalizeQishuiPinnedModes(['fresh', 'fresh', 7, 'a b', '32'])).toEqual(['fresh', '32'])
    expect(normalizeQishuiPinnedModes(['1', '2', '3', '4', '5', '6', '7'])).toHaveLength(QISHUI_MAX_PINNED_MODES)
  })

  it('常用区内拖动调整顺序', () => {
    expect(applyModeDrop(['a', 'b', 'c'], 'a', { zone: 'row', index: 2 })).toEqual(['b', 'c', 'a'])
    expect(applyModeDrop(['a', 'b', 'c'], 'c', { zone: 'row', index: 0 })).toEqual(['c', 'a', 'b'])
    expect(applyModeDrop(['a', 'b', 'c'], 'b', { zone: 'row', index: 1 })).toEqual(['a', 'b', 'c'])
  })

  it('有空位时插入到落点', () => {
    expect(applyModeDrop(['a', 'b'], 'x', { zone: 'row', index: 1 })).toEqual(['a', 'x', 'b'])
    expect(applyModeDrop(['a', 'b'], 'x', { zone: 'row', index: 9 })).toEqual(['a', 'b', 'x'])
    expect(applyModeDrop([], 'x', { zone: 'row', index: 0 })).toEqual(['x'])
  })

  it('满了时替换落点那个，总数不超过上限', () => {
    const full = ['a', 'b', 'c', 'd', 'e']
    expect(applyModeDrop(full, 'x', { zone: 'row', index: 1 })).toEqual(['a', 'x', 'c', 'd', 'e'])
    expect(applyModeDrop(full, 'x', { zone: 'row', index: 9 })).toEqual(['a', 'b', 'c', 'd', 'x'])
    expect(applyModeDrop(full, 'a', { zone: 'row', index: 4 })).toEqual(['b', 'c', 'd', 'e', 'a'])
  })

  it('拖回“更多”取消固定；落在别处不变', () => {
    expect(applyModeDrop(['a', 'b'], 'a', { zone: 'tray' })).toEqual(['b'])
    expect(applyModeDrop(['a', 'b'], 'x', { zone: 'tray' })).toEqual(['a', 'b'])
    expect(applyModeDrop(['a', 'b'], 'a', null)).toEqual(['a', 'b'])
  })
})
