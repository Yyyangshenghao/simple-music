import { describe, expect, it } from 'vitest'
import { buildPopWords, popEmphasis } from './pop-lyric-timing'

const timed = (parts: [string, number, number][]) => ({
  time: 10,
  durationMs: 3000,
  words: parts.map(([text, startMs, durationMs]) => ({ text, startMs, durationMs }))
})

describe('buildPopWords', () => {
  it('有原生逐字时序时原样使用', () => {
    const words = buildPopWords('甲乙丙', timed([['甲', 0, 200], ['乙', 200, 200], ['丙', 400, 200]]), 3)
    expect(words.map((w) => [w.text, w.startMs, w.durationMs])).toEqual([['甲', 0, 200], ['乙', 200, 200], ['丙', 400, 200]])
  })

  it('纯 LRC 按字数估算，揭示窗口不拖满整段间隔', () => {
    const words = buildPopWords('测试一句话', undefined, 20)
    expect(words.map((w) => w.text).join('')).toBe('测试一句话')
    const last = words[words.length - 1]
    expect(last.startMs + last.durationMs).toBeLessThanOrEqual(5 * 260 + 1)
    for (let i = 1; i < words.length; i++) expect(words[i].startMs).toBeGreaterThanOrEqual(words[i - 1].startMs)
  })

  it('估算窗口不超过停留时长的 85%', () => {
    const words = buildPopWords('这是一句比较长的测试歌词文本', undefined, 1.5)
    const last = words[words.length - 1]
    expect(last.startMs + last.durationMs).toBeLessThanOrEqual(1500 * 0.85 + 1)
  })

  it('弹出时长随词长收敛在 140~380ms，极短句直接出现', () => {
    const normal = buildPopWords('甲乙', timed([['甲', 0, 60], ['乙', 60, 2000]]), 3)
    expect(normal[0].popMs).toBe(140)
    expect(normal[1].popMs).toBe(380)
    expect(buildPopWords('甲乙', timed([['甲', 0, 100], ['乙', 100, 100]]), 0.2).every((w) => w.popMs === 0)).toBe(true)
  })
})

describe('popEmphasis', () => {
  it('拖长音的词放大，普通词保持原大', () => {
    const scales = popEmphasis([
      { text: '一', durationMs: 200 }, { text: '二', durationMs: 220 }, { text: '三', durationMs: 900 }, { text: '四', durationMs: 210 }
    ])
    expect(scales[0]).toBe(1)
    expect(scales[2]).toBeGreaterThan(1)
    expect(scales[2]).toBeLessThanOrEqual(1.32)
  })

  it('按单字时长比较，多字词不会因为字多而被放大', () => {
    const scales = popEmphasis([
      { text: '一二三四', durationMs: 800 }, { text: '五', durationMs: 200 }, { text: '六', durationMs: 210 }
    ])
    expect(scales).toEqual([1, 1, 1])
  })

  it('词太少或时长均匀时不放大', () => {
    expect(popEmphasis([{ text: '一', durationMs: 200 }, { text: '二', durationMs: 900 }])).toEqual([1, 1])
    expect(popEmphasis([{ text: '一', durationMs: 300 }, { text: '二', durationMs: 300 }, { text: '三', durationMs: 300 }])).toEqual([1, 1, 1])
  })
})
