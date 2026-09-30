import { describe, expect, it } from 'vitest'
import { planStageLyricRows } from './stage-lyric-wrap'

const measure = (text: string) => text.length * 10

describe('planStageLyricRows', () => {
  it('短句保持一行', () => {
    expect(planStageLyricRows('短句歌词', 100, measure).lines).toEqual(['短句歌词'])
  })
  it('长句分成宽度接近的两行', () => {
    const rows = planStageLyricRows('我的上一辈过的平庸 所以强制地打开我机械的read mode', 190, measure)
    expect(rows.lines).toHaveLength(2)
    expect(rows.lines.join(' ')).toContain('read mode')
    expect(Math.max(...rows.lines.map(measure))).toBeLessThan(measure('我的上一辈过的平庸 所以强制地打开我机械的read mode'))
  })
  it('英文优先在空格处断行', () => {
    const rows = planStageLyricRows('Hello wonderful world today', 100, measure)
    expect(rows.lines).toEqual(['Hello wonderful', 'world today'])
  })
  it('原生逐字数据只在词边界断行，边界仍连续覆盖两行', () => {
    const words = ['你好', '世界', '歌声', '响起'].map((text, i) => ({ text, startMs: i * 100, durationMs: 100 }))
    const rows = planStageLyricRows(words.map((word) => word.text).join(''), 50, measure, words)
    expect(rows.lines).toEqual(['你好世界', '歌声响起'])
    expect(rows.splitWordIndex).toBe(2)
    expect(rows.wordBoundaries).toEqual([0, 0.25, 0.5, 0.75, 1])
  })
})
