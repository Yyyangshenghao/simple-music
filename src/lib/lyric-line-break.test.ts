import { describe, expect, it } from 'vitest'
import { groupLyricBreakUnits, lyricBreakPoints } from './lyric-line-break'

const join = (tokens: string[]) => groupLyricBreakUnits(tokens).map((g) => g.map((i) => tokens[i]).join(''))

describe('groupLyricBreakUnits', () => {
  it('逐字 token 按中文词组归并', () => {
    expect(join(Array.from('我们一起看星星'))).toEqual(['我们', '一起', '看', '星星'])
  })

  it('闭合标点粘在前一个单元，开启标点粘在后一个单元', () => {
    expect(join(Array.from('今天晴朗，明天「下雨」'))).toEqual(['今天', '晴朗，', '明天', '「下雨」'])
  })

  it('英文按空格断开，单词内的多个 token 不拆', () => {
    expect(join(['hel', 'lo ', 'wor', 'ld'])).toEqual(['hello ', 'world'])
  })

  it('多字 token 原样保留，单元覆盖全部 token 且保持顺序', () => {
    const tokens = ['我们', '一起', '看', '星星', '。']
    const groups = groupLyricBreakUnits(tokens)
    expect(groups.flat()).toEqual([0, 1, 2, 3, 4])
    expect(join(tokens)).toEqual(['我们', '一起', '看', '星星。'])
  })

  it('过长的单元会被截断，避免撑破一行', () => {
    const units = join(Array.from('aaaaaaaaaaaaaaaa'))
    expect(units.every((u) => u.length <= 8)).toBe(true)
    expect(units.join('')).toBe('aaaaaaaaaaaaaaaa')
  })

  it('空输入返回空', () => {
    expect(groupLyricBreakUnits([])).toEqual([])
  })

  it('换行点不落在标点前', () => {
    const tokens = Array.from('你好，世界')
    expect([...lyricBreakPoints(tokens)]).not.toContain(2)
  })
})
