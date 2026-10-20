import { describe, expect, it } from 'vitest'
import { lyricDistance, lyricFollowDelay, LYRIC_FOLLOW_MAX_DELAY_MS, LYRIC_FOLLOW_STEP_MS } from './lyric-follow'

describe('lyricFollowDelay', () => {
  it('已唱过的行不延迟，当前行起逐行递增', () => {
    expect(lyricFollowDelay(3, 5)).toBe(0)
    expect(lyricFollowDelay(4, 5)).toBe(0)
    expect(lyricFollowDelay(5, 5)).toBe(LYRIC_FOLLOW_STEP_MS)
    expect(lyricFollowDelay(6, 5)).toBe(LYRIC_FOLLOW_STEP_MS * 2)
  })

  it('远处的行延迟有上限', () => {
    expect(lyricFollowDelay(80, 5)).toBe(LYRIC_FOLLOW_MAX_DELAY_MS)
  })
})

describe('lyricDistance', () => {
  it('按与当前行的距离分档并封顶', () => {
    expect(lyricDistance(5, 5)).toBe(0)
    expect(lyricDistance(3, 5)).toBe(2)
    expect(lyricDistance(40, 5)).toBe(6)
  })

  it('尚未进入第一句时首行也视为非当前行', () => {
    expect(lyricDistance(0, -1)).toBe(1)
    expect(lyricDistance(2, -1)).toBe(3)
  })
})
