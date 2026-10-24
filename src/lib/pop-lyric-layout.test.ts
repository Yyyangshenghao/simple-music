import { describe, expect, it } from 'vitest'
import { buildPopUnits, estimatePopRows, planPopRows, popTextWeight, popScene, popPhrasePose } from './pop-lyric-layout'
import { buildPopWords } from './pop-lyric-timing'

const plan = (text: string, maxEm: number) => {
  const words = buildPopWords(text, undefined, 10)
  const units = buildPopUnits(words)
  const widths = units.map(unit => popTextWeight(unit.words.map(i => words[i].text).join('')))
  const result = planPopRows(units, widths, 0.45, maxEm)
  return { ...result, lines: result.rows.map(row => row.flatMap(u => units[u].words).map(i => words[i].text).join('')) }
}

describe('跃字分行', () => {
  it('短句一击、中句两组、长句三组；保留词序和语义边界', () => {
    for (const [text, count] of [['此刻', 1], ['让每个音符都有自己的形状', 2], ['在这只属于你我的空旷夜空下慢慢地溶化成一片温柔的光', 3]] as const) {
      const words = buildPopWords(text, undefined, 10)
      const scene = popScene(words, 10)
      expect(scene.rows).toBe(count)
      const { units, rows } = estimatePopRows(words, 30, scene.rows)
      expect(rows).toHaveLength(count)
      expect(rows.flat().flatMap(u => units[u].words)).toEqual(words.map((_, index) => index))
    }
    expect(popScene(buildPopWords('让每个音符都有自己的形状', undefined, 0.8), 0.8).rows).toBe(1)
  })

  it('词组有明确大小主次，姿态固定且左右交错，单词不可拆时不强分组', () => {
    const first = popPhrasePose(2, 0, 5000)
    const last = popPhrasePose(2, 1, 5000)
    expect(last.scale / first.scale).toBeGreaterThan(1.3)
    expect(first.align).not.toBe(last.align)
    expect(Math.abs(first.angle)).toBeLessThan(2)
    expect(popPhrasePose(2, 0, 5000)).toEqual(first)
    expect(estimatePopRows(buildPopWords('Unforgettable', undefined, 5), 10, 2).rows).toHaveLength(1)
  })

  it('英文按字面长度判断孤尾，不把完整长词误当成孤字而堆到末组', () => {
    const words = buildPopWords('Everything unforgettable eventually becomes extraordinary', undefined, 10)
    const { units, rows } = estimatePopRows(words, 30, 3)
    const last = rows.at(-1)!.flatMap(u => units[u].words).map(i => words[i].text).join('').trim()
    expect(last).not.toContain('eventually')
  })

  it.each(['此刻', '让每个音符都有自己的形状', '如果漂泊是成长 必经的路牌', 'Let every note find its own shape.'])('保留全部歌词与原有词序：%s', text => {
    const words = buildPopWords(text, undefined, 10)
    const before = JSON.stringify(words)
    const { units, rows } = estimatePopRows(words)
    expect(rows.flat().flatMap(u => units[u].words)).toEqual(words.map((_, index) => index))
    expect(JSON.stringify(words)).toBe(before)
  })

  it('放得下就排成一行；放不下才折行，不留一两个字的孤尾', () => {
    expect(plan('让每个音符都有自己的形状', 14).lines).toEqual(['让每个音符都有自己的形状'])
    const two = plan('让每个音符都有自己的形状', 9).lines
    expect(two).toHaveLength(2)
    expect(two.every(line => Array.from(line).length >= 4)).toBe(true)
  })

  it('优先在空格、标点处断开；单字方位词与介词不与所属词组分开', () => {
    expect(plan('如果漂泊是成长 必经的路牌', 9).lines.map(line => line.trim())).toEqual(['如果漂泊是成长', '必经的路牌'])
    const lines = plan('在这只属于你我的空旷夜空下慢慢地溶化成一片温柔的光', 15).lines
    expect(lines).toHaveLength(2)
    expect(lines.some(line => line.startsWith('下'))).toBe(false)
    expect(lines[0].endsWith('下')).toBe(true)
  })

  it('三行仍放不下时整体缩字号，不让 CSS 再折行', () => {
    const result = plan('Everything unforgettable eventually becomes extraordinary', 4)
    expect(result.rows.length).toBeLessThanOrEqual(3)
    expect(result.fit).toBeLessThan(1)
    expect(plan('此刻', 10).fit).toBe(1)
  })

  it('同一句同一宽度分行固定', () => {
    expect(plan('让每个音符都有自己的形状', 9)).toEqual(plan('让每个音符都有自己的形状', 9))
  })
})
