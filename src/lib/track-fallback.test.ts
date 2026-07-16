import { describe, it, expect } from 'vitest'
import { matchFallbackTrack, normalizeText, otherSource } from './track-fallback'
import type { Track } from '../types/domain'

function makeTrack(partial: Partial<Track>): Track {
  return {
    provider: 'netease',
    source: 'netease',
    type: 'song',
    id: 1,
    name: '晴天',
    artist: '周杰伦',
    artists: [{ id: 1, name: '周杰伦' }],
    duration: 269000,
    ...partial
  }
}

describe('otherSource', () => {
  it('两个音源互为对侧', () => {
    expect(otherSource('netease')).toBe('qq')
    expect(otherSource('qq')).toBe('netease')
  })
})

describe('normalizeText', () => {
  it('小写、全角括号转半角、去空白', () => {
    expect(normalizeText('晴天 （Live）')).toBe('晴天(live)')
    expect(normalizeText('Mojito ')).toBe('mojito')
  })
})

describe('matchFallbackTrack', () => {
  const original = makeTrack({})

  it('标题+艺人+时长全部吻合时命中', () => {
    const candidate = makeTrack({ source: 'qq', id: 'x', duration: 270500 })
    expect(matchFallbackTrack(original, [candidate])).toBe(candidate)
  })

  it('取候选中第一个匹配(按搜索相关性排序)', () => {
    const wrong = makeTrack({ source: 'qq', name: '晴天 (Live)', duration: 269000 })
    const right = makeTrack({ source: 'qq', id: 'r' })
    expect(matchFallbackTrack(original, [wrong, right])).toBe(right)
  })

  it('标题不同(Live 版)不命中', () => {
    const candidate = makeTrack({ source: 'qq', name: '晴天 (Live)' })
    expect(matchFallbackTrack(original, [candidate])).toBeNull()
  })

  it('标题空白/全角差异抹平后仍命中', () => {
    const original2 = makeTrack({ name: '说好不哭（with 五月天阿信）' })
    const candidate = makeTrack({ source: 'qq', name: '说好不哭 (with 五月天阿信)' })
    expect(matchFallbackTrack(original2, [candidate])).toBe(candidate)
  })

  it('艺人无交集(翻唱)不命中', () => {
    const cover = makeTrack({ source: 'qq', artist: '翻唱歌手', artists: [{ id: 9, name: '翻唱歌手' }] })
    expect(matchFallbackTrack(original, [cover])).toBeNull()
  })

  it('合唱曲目艺人有交集即命中', () => {
    const duet = makeTrack({
      source: 'qq',
      artists: [
        { id: 1, name: '周杰伦' },
        { id: 2, name: '五月天阿信' }
      ]
    })
    expect(matchFallbackTrack(original, [duet])).toBe(duet)
  })

  it('artists 为空时退化到 artist 字符串按分隔符拆分', () => {
    const candidate = makeTrack({ source: 'qq', artists: [], artist: '周杰伦/五月天阿信' })
    expect(matchFallbackTrack(original, [candidate])).toBe(candidate)
  })

  it('时长差超过 3s 不命中', () => {
    const candidate = makeTrack({ source: 'qq', duration: 269000 + 3001 })
    expect(matchFallbackTrack(original, [candidate])).toBeNull()
  })

  it('任一侧缺时长时跳过时长校验', () => {
    const candidate = makeTrack({ source: 'qq', duration: undefined })
    expect(matchFallbackTrack(original, [candidate])).toBe(candidate)
  })

  it('无候选返回 null', () => {
    expect(matchFallbackTrack(original, [])).toBeNull()
  })
})
