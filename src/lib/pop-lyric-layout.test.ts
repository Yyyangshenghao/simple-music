import { describe, expect, it } from 'vitest'
import { buildPopLyricLayout } from './pop-lyric-layout'
import { buildPopWords } from './pop-lyric-timing'

describe('跃字动态分句', () => {
  it.each(['此刻', '让每个音符都有自己的形状', '把很长很长的故事留在风里，再让每个字随着旋律找到属于自己的位置。', 'Let every note find its own shape.'])('排版保留全部歌词和原生时间顺序：%s', text => {
    const words = buildPopWords(text, undefined, 10)
    const before = JSON.stringify(words)
    const layout = buildPopLyricLayout(words, 10, 1000)
    expect(layout.phrases.flatMap(phrase => phrase.units.flat())).toEqual(words.map((_, index) => index))
    expect(JSON.stringify(words)).toBe(before)
    expect(layout.phrases.every(phrase => phrase.units.length > 0)).toBe(true)
  })

  it('短句聚焦、中句错落、长句分阶，快句收回一段保证可读', () => {
    const layout = (text: string, dwell = 8) => buildPopLyricLayout(buildPopWords(text, undefined, dwell), dwell, 1000)
    expect(layout('此刻').composition).toBe('impact')
    expect(layout('让每个音符都有自己的形状').phrases).toHaveLength(2)
    expect(layout('把很长很长的故事留在风里，再让每个字随着旋律找到属于自己的位置。').phrases).toHaveLength(3)
    expect(layout('让每个音符都有自己的形状', 0.5).phrases).toHaveLength(1)
  })

  it('不拆原生整词 token；同一句构图稳定，相邻句改变方向', () => {
    const words = buildPopWords('Alpha beta, gamma delta', { time: 5, durationMs: 4000, words: [
      { text: 'Alpha beta, ', startMs: 0, durationMs: 1000 }, { text: 'gamma delta', startMs: 1200, durationMs: 1000 },
    ] }, 4)
    const layout = buildPopLyricLayout(words, 4, 1000)
    expect(layout.phrases.flatMap(phrase => phrase.units.flat())).toEqual([0, 1])
    expect(layout).toEqual(buildPopLyricLayout(words, 4, 1000))
    expect(layout.phrases[0].align).not.toEqual(buildPopLyricLayout(words, 4, 2000).phrases[0].align)
  })
})
