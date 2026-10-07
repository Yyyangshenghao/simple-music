import { describe, expect, it } from 'vitest'
import { applySelection, intersectsSelection, rangeSelection, selectionRect, selectionScrollDelta, virtualSelectionKeys } from './multi-selection'

describe('多选范围与框选', () => {
  it('在悬浮顶栏和播放器之外的可见内容边缘自动滚动，中央不滚动', () => {
    const viewport = { left: 0, right: 1200, top: 0, bottom: 800 }
    const visible = { ...viewport, top: 64, bottom: 676 }
    expect(selectionScrollDelta(72, viewport)).toBe(0)
    expect(selectionScrollDelta(668, viewport)).toBe(0)
    expect(selectionScrollDelta(72, visible)).toBeLessThan(0)
    expect(selectionScrollDelta(668, visible)).toBeGreaterThan(0)
    expect(selectionScrollDelta(400, visible)).toBe(0)
    expect(selectionScrollDelta(0, visible)).toBe(-18)
    expect(selectionScrollDelta(800, visible)).toBe(18)
  })
  it('向左上拖动与正向拖动产生同一区域，仅接触边缘不会误选', () => {
    const rect = selectionRect(120, 300, 20, 100)
    expect(rect).toEqual(selectionRect(20, 100, 120, 300))
    expect(intersectsSelection(rect, { left: 120, right: 160, top: 100, bottom: 150 })).toBe(false)
  })
  it('滚动后的虚拟行坐标覆盖未挂载的歌曲，边界不多选一行', () => {
    const keys = Array.from({ length: 1000 }, (_, index) => String(index))
    const list = { left: 20, right: 500, top: -5600, bottom: 50400 }
    expect(virtualSelectionKeys({ left: 30, right: 200, top: 0, bottom: 112 }, list, 56, keys)).toEqual(['100', '101'])
    expect(virtualSelectionKeys({ left: 500, right: 520, top: 0, bottom: 112 }, list, 56, keys)).toEqual([])
  })
  it('Shift 连选按显示顺序工作，过滤结果中找不到旧锚点时只选当前项', () => {
    expect(rangeSelection(['a', 'b', 'c', 'd'], 'd', 'b')).toEqual(['b', 'c', 'd'])
    expect(rangeSelection(['a', 'c'], 'b', 'c')).toEqual(['c'])
  })
  it('拖动始终基于起始快照，追加和反选不会随鼠标帧数反复切换', () => {
    const base = new Set(['a', 'b'])
    expect([...applySelection(base, ['b', 'c'], 'replace')]).toEqual(['b', 'c'])
    expect([...applySelection(base, ['b', 'c'], 'add')]).toEqual(['a', 'b', 'c'])
    expect([...applySelection(base, ['b', 'c'], 'toggle')]).toEqual(['a', 'c'])
    expect([...base]).toEqual(['a', 'b'])
  })
})
