import { describe, expect, it } from 'vitest'
import { measureWordBoundaries, stageLyricProgress, stageWordTimeline } from './stage-lyric-progress'
import type { WordLyricLine } from '../../types/domain'

const line: WordLyricLine = {
  time: 10,
  durationMs: 1200,
  words: [
    { text: '中', startMs: 0, durationMs: 40 },
    { text: 'i', startMs: 300, durationMs: 100 },
    { text: '文', startMs: 600, durationMs: 0 }
  ]
}
const boundaries = [0, 0.45, 0.55, 1]

describe('stageLyricProgress', () => {
  it('使用原始短字时长且不提前点亮', () => {
    expect(stageLyricProgress(9.999, line, boundaries)).toBe(0)
    expect(stageLyricProgress(10.02, line, boundaries)).toBeCloseTo(0.225)
    expect(stageLyricProgress(10.04, line, boundaries)).toBeCloseTo(0.45)
  })

  it('字间停顿保持已唱边界，零时长字在时间戳瞬时点亮', () => {
    expect(stageLyricProgress(10.2, line, boundaries)).toBeCloseTo(0.45)
    expect(stageLyricProgress(10.5, line, boundaries)).toBeCloseTo(0.55)
    expect(stageLyricProgress(10.6, line, boundaries)).toBe(1)
  })

  it('向前或向后拖动直接定位，不依赖上一帧累计进度', () => {
    expect(stageLyricProgress(12, line, boundaries)).toBe(1)
    expect(stageLyricProgress(10.35, line, boundaries)).toBeCloseTo(0.5)
    expect(stageLyricProgress(9, line, boundaries)).toBe(0)
  })

  it('普通或估算歌词整句点亮，不伪造逐字进度', () => {
    expect(stageLyricProgress(10, undefined, [])).toBe(1)
    expect(stageLyricProgress(10, { ...line, words: [{ text: '中', startMs: 0 }] }, [0, 1])).toBe(1)
  })

  it('无效时序不会上传 NaN 或负时间到逐字纹理', () => {
    for (const word of [
      { text: '中', startMs: 0, durationMs: NaN },
      { text: '中', startMs: -10, durationMs: 100 },
      { text: '中', startMs: 0, durationMs: -100 }
    ]) {
      const invalid = { ...line, words: [word] }
      expect(stageWordTimeline(invalid, [0, 1])).toHaveLength(0)
      expect(stageLyricProgress(10, invalid, [0, 1])).toBe(1)
    }
  })

  it('重叠字各自按时间戳推进，不等待前一个长字结束', () => {
    const overlap: WordLyricLine = { time: 10, durationMs: 2000, words: [
      { text: '长', startMs: 0, durationMs: 2000 },
      { text: '短', startMs: 100, durationMs: 400 }
    ] }
    expect(stageLyricProgress(10.2, overlap, [0, 0.5, 1])).toBeCloseTo(0.625)
    expect([...stageWordTimeline(overlap, [0, 0.5, 1])]).toEqual([
      0, 0.5, 0, 2,
      0.5, 1, expect.closeTo(0.1), expect.closeTo(0.4)
    ])
  })
})

describe('measureWordBoundaries', () => {
  it('按实际字宽映射中英混排，宽字不会与窄字均分进度', () => {
    const widths: Record<string, number> = { 中: 18, i: 4, 文: 18 }
    const measure = (text: string) => [...text].reduce((sum, char) => sum + widths[char], 0)
    expect(measureWordBoundaries(line.words, measure)).toEqual(boundaries)
  })

  it('与纹理一致折叠空白并裁去首尾空白，保留词间空格位置', () => {
    const words = ['  A ', '\n ', 'B  '].map((text) => ({ text, startMs: 0, durationMs: 10 }))
    const measured: string[] = []
    const result = measureWordBoundaries(words, (text) => { measured.push(text); return text.length })
    expect(result).toEqual([0, 2 / 3, 2 / 3, 1])
    expect(measured).not.toContain('A  ')
    expect(measured).toContain('A B')
  })
})
