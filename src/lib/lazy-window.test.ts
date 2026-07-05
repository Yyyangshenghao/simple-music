import { describe, expect, it } from 'vitest'
import { TRACK_WINDOW, windowIndicesFor, windowSpan, virtualRange, makePlaceholderTrack, buildQueue } from './lazy-window'
import type { Track } from '../types/domain'

function fakeTrack(id: number): Track {
  return { provider: 'netease', source: 'netease', type: 'song', id, name: `song-${id}`, artist: '', artists: [] }
}

describe('windowIndicesFor', () => {
  it('覆盖区间对应的窗口序号', () => {
    expect(windowIndicesFor(0, 100, 100, 650)).toEqual([0])
    expect(windowIndicesFor(50, 150, 100, 650)).toEqual([0, 1])
    expect(windowIndicesFor(600, 650, 100, 650)).toEqual([6])
  })
  it('end 超过 total 时截到最后一个窗口', () => {
    expect(windowIndicesFor(600, 900, 100, 650)).toEqual([6])
  })
  it('空区间或空列表返回空', () => {
    expect(windowIndicesFor(10, 10, 100, 650)).toEqual([])
    expect(windowIndicesFor(0, 100, 100, 0)).toEqual([])
  })
})

describe('windowSpan', () => {
  it('普通窗口', () => {
    expect(windowSpan(1, 100, 650)).toEqual({ start: 100, end: 200 })
  })
  it('末窗口截断到 total', () => {
    expect(windowSpan(6, 100, 650)).toEqual({ start: 600, end: 650 })
  })
})

describe('virtualRange', () => {
  it('列表起点在滚动容器顶部时的可视窗口', () => {
    // 视口 560px / 行高 56px = 10 行,overscan 5
    expect(virtualRange(0, 560, 0, 56, 650, 5)).toEqual({ start: 0, end: 15 })
  })
  it('滚到中部:前后各扩 overscan', () => {
    // scrollTop 5600 → 第 100 行起
    expect(virtualRange(5600, 560, 0, 56, 650, 5)).toEqual({ start: 95, end: 115 })
  })
  it('列表上方有 header(listTop > 0)时按偏移换算', () => {
    expect(virtualRange(200, 560, 200, 56, 650, 5)).toEqual({ start: 0, end: 15 })
  })
  it('end 不超过 total,start 不小于 0', () => {
    const r = virtualRange(999999, 560, 0, 56, 650, 5)
    expect(r.end).toBe(650)
    expect(r.start).toBeLessThanOrEqual(r.end)
    expect(virtualRange(-100, 560, 0, 56, 650, 5).start).toBe(0)
  })
  it('total 为 0 返回空区间', () => {
    expect(virtualRange(0, 560, 0, 56, 0, 5)).toEqual({ start: 0, end: 0 })
  })
})

describe('buildQueue', () => {
  it('已加载的用真曲目,未加载的用 pending 占位', () => {
    const loaded = fakeTrack(1)
    const queue = buildQueue([1, 2], [loaded, null], 'netease')
    expect(queue).toHaveLength(2)
    expect(queue[0]).toBe(loaded)
    expect(queue[1].pending).toBe(true)
    expect(String(queue[1].id)).toBe('2')
    expect(queue[1].source).toBe('netease')
  })
})

describe('makePlaceholderTrack', () => {
  it('占位曲目字段完整可安全渲染', () => {
    const t = makePlaceholderTrack(42, 'netease')
    expect(t.pending).toBe(true)
    expect(t.name).toBe('')
    expect(t.artists).toEqual([])
  })
})

describe('TRACK_WINDOW', () => {
  it('窗口大小为 100', () => {
    expect(TRACK_WINDOW).toBe(100)
  })
})
