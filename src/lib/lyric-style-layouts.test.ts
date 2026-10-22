import { describe, it, expect } from 'vitest'
import { buildStyleWords, luminousLayout, partitaLayout, seededRandom, splitRows, tiltLayout, wordState, type StyleWord } from './lyric-style-layouts'

const words = (text: string): StyleWord[] => Array.from(text).map((char, i) => ({ text: char, startMs: i * 300, endMs: i * 300 + 300 }))

describe('逐词时间状态', () => {
  it('按相对行起点的毫秒判断等待、演唱和唱后', () => {
    const word = { text: '甲', startMs: 1000, endMs: 1500 }
    expect(wordState(word, 500)).toMatchObject({ phase: 'waiting', progress: 0, sinceStart: -500 })
    expect(wordState(word, 1250)).toMatchObject({ phase: 'active', progress: 0.5 })
    expect(wordState(word, 2000)).toMatchObject({ phase: 'passed', progress: 1, sinceEnd: 500 })
  })

  it('空格不单独成词：并入前一个词，句首空格留给下一个词', () => {
    const line = { time: 0, durationMs: 2000, words: [
      { text: ' ', startMs: 0, durationMs: 0 }, { text: '我们', startMs: 0, durationMs: 400 }, { text: ' ', startMs: 400, durationMs: 0 },
      { text: '过了', startMs: 500, durationMs: 400 }, { text: ' ', startMs: 900, durationMs: 0 },
    ] }
    const result = buildStyleWords(' 我们 过了 ', line, 3)
    expect(result.map(word => word.text)).toEqual([' 我们 ', '过了 '])
    expect(result.every(word => word.text.trim())).toBe(true)
  })

  it('没有逐字时间的句子按字数估算，结束时间不早于开始', () => {
    const result = buildStyleWords('让每个音符都有形状', undefined, 4)
    expect(result.length).toBeGreaterThan(1)
    for (const word of result) expect(word.endMs).toBeGreaterThan(word.startMs)
  })
})

describe('排版的可复现性', () => {
  it('同一种子给出同一串数，不同种子不同', () => {
    const a = seededRandom(12.5)
    const b = seededRandom(12.5)
    const c = seededRandom(13.5)
    const seq = (rand: () => number) => Array.from({ length: 5 }, rand)
    const first = seq(a)
    expect(seq(b)).toEqual(first)
    expect(seq(c)).not.toEqual(first)
    expect(first.every(value => value >= 0 && value < 1)).toBe(true)
  })

  it('三种排版对同一句、同一种子完全一致', () => {
    const line = words('今日见到的夕阳洒落漫天星点')
    expect(luminousLayout(line, 5, { spread: 1, rotation: true })).toEqual(luminousLayout(line, 5, { spread: 1, rotation: true }))
    expect(tiltLayout(line, 5, { split: 0.6, tilt: 0.5 })).toEqual(tiltLayout(line, 5, { split: 0.6, tilt: 0.5 }))
    expect(partitaLayout(line, 5, { step: 1, semantic: true })).toEqual(partitaLayout(line, 5, { step: 1, semantic: true }))
  })
})

describe('分行', () => {
  it('覆盖全部词且保持顺序，各行字数均衡', () => {
    const tokens = Array.from('今天的风吹过了我们的城市')
    const rows = splitRows(tokens, 3)
    expect(rows.flat()).toEqual(tokens.map((_, i) => i))
    expect(rows).toHaveLength(3)
    const sizes = rows.map(row => row.length)
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(3)
  })

  it('不在英文单词中间或标点前断开', () => {
    const tokens = ['Every ', 'word ', 'lands ', 'on ', 'the ', 'beat,', ' ok']
    for (const row of splitRows(tokens, 3)) expect(row.length).toBeGreaterThan(0)
    const punct = splitRows(Array.from('你好，世界'), 2)
    expect(punct.every(row => !'，'.includes(Array.from('你好，世界')[row[0]]))).toBe(true)
  })

  it('行数不超过可断开的单元数', () => {
    expect(splitRows(['唯一'], 4)).toEqual([[0]])
    expect(splitRows([], 2)).toEqual([])
  })
})

describe('三种样式的排版', () => {
  it('流光：关闭倾角时不旋转，散布为 0 时原位', () => {
    const line = words('让每个音符都有自己的形状')
    expect(luminousLayout(line, 3, { spread: 1, rotation: false }).every(pose => pose.rotate === 0)).toBe(true)
    expect(luminousLayout(line, 3, { spread: 0, rotation: true }).every(pose => pose.x === 0 && pose.y === 0 && pose.rotate === 0)).toBe(true)
  })

  it('倾诉：短句一行；长句多行时同时有正体和斜体', () => {
    expect(tiltLayout(words('我们'), 1, { split: 1, tilt: 0.5 })).toHaveLength(1)
    for (let seed = 0; seed < 20; seed++) {
      const rows = tiltLayout(words('自己也能在云天自由翱翔的我们'), seed, { split: 1, tilt: 0.5 })
      expect(rows.length).toBeGreaterThan(1)
      expect(rows.some(row => row.italic)).toBe(true)
      expect(rows.some(row => !row.italic)).toBe(true)
    }
    expect(tiltLayout(words('自己也能在云天自由翱翔的我们'), 2, { split: 0, tilt: 0.5 })).toHaveLength(1)
    // 长句只要允许分行就至少两行。
    for (let seed = 0; seed < 20; seed++) expect(tiltLayout(words('在这只属于你我的空旷夜空下慢慢地溶化'), seed, { split: 0.05, tilt: 0.5 }).length).toBeGreaterThanOrEqual(2)
    expect(tiltLayout(words('自己也能在云天自由翱翔'), 2, { split: 1, tilt: 0 }).every(row => !row.italic)).toBe(true)
  })

  it('云阶：长句分多行、左右交替错落；关闭语义分组按字数切；错落为 0 时对齐', () => {
    const line = words('今日见到的夕阳洒落漫天星点')
    const rows = partitaLayout(line, 9, { step: 1, semantic: true })
    expect(rows.length).toBeGreaterThan(1)
    for (let i = 1; i < rows.length; i++) expect(Math.sign(rows[i].offset)).toBe(-Math.sign(rows[i - 1].offset))
    const hard = partitaLayout(line, 9, { step: 1, semantic: false, maxChars: 5 })
    expect(hard.every(row => row.words.length <= 5)).toBe(true)
    expect(partitaLayout(line, 9, { step: 0, semantic: true }).every(row => row.offset === 0)).toBe(true)
    expect(partitaLayout(words('短句'), 9, { step: 1, semantic: true })).toEqual([{ words: [0, 1], offset: 0 }])
    // 超长句最多 5 级台阶，加宽每行而不是无限加行。
    const long = words('一二三四五六七八九十'.repeat(8))
    expect(partitaLayout(long, 9, { step: 1, semantic: true }).length).toBeLessThanOrEqual(5)
    expect(partitaLayout(long, 9, { step: 1, semantic: false }).length).toBeLessThanOrEqual(5)
  })
})
