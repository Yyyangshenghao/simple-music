import { describe, it, expect } from 'vitest'
import { buildStyleWords, partitaLayout, partitaRowsForStage, seededRandom, splitRows, wordState, type StyleWord } from './lyric-style-layouts'

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

  it('云阶排版对同一句、同一种子完全一致', () => {
    const line = words('今日见到的夕阳洒落漫天星点')
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

describe('云阶排版', () => {
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

describe('云阶按舞台定级数', () => {
  it('舞台放得下就沿用自然台阶（约 5 字一级）', () => {
    expect(partitaRowsForStage(words('让每个音符都有自己的形状'), { width: 13, height: 6.5 })).toBe(3)
    expect(partitaRowsForStage(words('我们'), { width: 13, height: 6.5 })).toBe(1)
  })

  it('常见窗口（含显示译文时）保持自然台阶，不为放大字号改断点；只有很矮的舞台才少分几级', () => {
    const long = words('在这只属于你我的空旷夜空下慢慢地溶化成一片温柔的光')
    expect(partitaRowsForStage(long, { width: 30, height: 30 })).toBe(5)
    // 960×720 显示两行译文、1536×960 时的舞台（以基准字号计）
    expect(partitaRowsForStage(long, { width: 8.6, height: 4.4 })).toBe(5)
    expect(partitaRowsForStage(long, { width: 13.2, height: 6.5 })).toBe(5)
    // 窄窗口也不改断点（字号由试排缩小）
    expect(partitaRowsForStage(words('让每个音符都有自己的形状'), { width: 4.5, height: 12 })).toBe(3)
    // 很矮：自然台阶会缩到八成以下，改少分几级
    expect(partitaRowsForStage(long, { width: 14, height: 3.2 })).toBeLessThan(5)
  })

  it('按给定级数分行，仍只在词组之间断开', () => {
    const line = words('在这只属于你我的空旷夜空下慢慢地溶化成一片温柔的光')
    const rows = partitaLayout(line, 3, { step: 1, semantic: true, rows: 3 })
    expect(rows).toHaveLength(3)
    expect(rows.flatMap(row => row.words)).toEqual(line.map((_, i) => i))
  })
})

