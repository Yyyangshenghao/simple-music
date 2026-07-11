import { describe, it, expect } from 'vitest'
import { buildRoamDescription, parseRoamDescription } from './roam-description'

describe('buildRoamDescription', () => {
  it('拼装水印/日期/歌手名单,用 · 分隔,歌手名单用 / 分隔', () => {
    expect(buildRoamDescription('2026-07-11', ['周杰伦', '邓紫棋'])).toBe(
      'Simple Music · 2026-07-11 · 周杰伦/邓紫棋'
    )
  })

  it('歌手名单为空时也能拼装(第三段为空字符串)', () => {
    expect(buildRoamDescription('2026-07-11', [])).toBe('Simple Music · 2026-07-11 · ')
  })
})

describe('parseRoamDescription', () => {
  it('build 后原样 parse 回来(round-trip)', () => {
    const desc = buildRoamDescription('2026-07-11', ['周杰伦', '邓紫棋', '林俊杰'])
    expect(parseRoamDescription(desc)).toEqual({
      date: '2026-07-11',
      artistNames: ['周杰伦', '邓紫棋', '林俊杰'],
    })
  })

  it('简介缺失返回 null', () => {
    expect(parseRoamDescription(undefined)).toBeNull()
  })

  it('简介不含水印返回 null(用户自建的同名歌单)', () => {
    expect(parseRoamDescription('随便写的简介 2026-07-11')).toBeNull()
  })

  it('日期格式不对返回 null', () => {
    expect(parseRoamDescription('Simple Music · 不是日期 · 周杰伦')).toBeNull()
  })

  it('段数不足返回 null', () => {
    expect(parseRoamDescription('Simple Music · 2026-07-11')).toBeNull()
  })

  it('容忍前后多余空白', () => {
    expect(parseRoamDescription('Simple Music ·  2026-07-11  · 周杰伦 / 邓紫棋')).toEqual({
      date: '2026-07-11',
      artistNames: ['周杰伦', '邓紫棋'],
    })
  })
})
