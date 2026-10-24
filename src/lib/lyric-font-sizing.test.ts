import { describe, expect, it } from 'vitest'
import { fitLyricFontScale } from './lyric-font-sizing'

describe('动态歌词字号与适配分离', () => {
  it('空间足够时保留用户请求的字号', () => {
    expect(fitLyricFontScale(1.5, { width: 200, height: 80 }, { width: 1000, height: 600 })).toBe(1.5)
  })
  it('长句先预留最大字号空间，调整过程中保持可感知比例且不溢出', () => {
    const content = { width: 900, height: 300 }
    const available = { width: 1000, height: 500 }
    const small = fitLyricFontScale(0.7, content, available)
    const large = fitLyricFontScale(1.5, content, available)
    expect(large / small).toBeCloseTo(1.5 / 0.7)
    expect(content.width * large).toBeLessThanOrEqual(available.width)
    expect(content.height * large).toBeLessThanOrEqual(available.height)
  })
})
