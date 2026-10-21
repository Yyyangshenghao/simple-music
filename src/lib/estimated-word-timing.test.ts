import { describe, expect, it } from 'vitest'
import { estimateLineWords } from './estimated-word-timing'
import { hasWordTiming } from './word-highlight-timeline'

// 测试数据只用占位文本
describe('估算逐字', () => {
  it('每字约 260ms，时间单调递增，结果可直接当逐字时序使用', () => {
    const words = estimateLineWords('甲乙丙丁', 20)
    expect(words.map((w) => w.text)).toEqual(['甲', '乙', '丙', '丁'])
    expect(words.map((w) => w.startMs)).toEqual([0, 260, 520, 780])
    expect(hasWordTiming(words)).toBe(true)
  })

  it('揭示窗口不超过停留时长的 85%', () => {
    const words = estimateLineWords('甲乙丙丁戊己庚辛壬癸', 1)
    const last = words[words.length - 1]
    expect(last.startMs + last.durationMs!).toBeLessThanOrEqual(851)
  })

  it('英文整词一个 token，空格不占时长', () => {
    const words = estimateLineWords('hello world', 20)
    expect(words.map((w) => w.text)).toEqual(['hello ', 'world'])
    expect(words[0].durationMs).toBe(words[1].durationMs)
  })
})
