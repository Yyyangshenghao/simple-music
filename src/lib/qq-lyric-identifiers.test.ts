import { describe, expect, it } from 'vitest'
import { qqLyricIdentifiers } from './qq-lyric-identifiers'
import type { Track } from '../types/domain'

function track(extra: Record<string, unknown>): Track {
  return {
    provider: 'qq',
    source: 'qq',
    type: 'song',
    id: 'domain-mid',
    name: '测试歌曲',
    artist: '测试歌手',
    artists: [],
    ...extra,
  }
}

describe('qqLyricIdentifiers', () => {
  it('优先使用 songmid，并只透传纯数字 qqId', () => {
    expect(qqLyricIdentifiers(track({
      songmid: 'song-mid',
      mid: 'fallback-mid',
      qqId: 123456,
    }))).toEqual({ mid: 'song-mid', id: 123456 })
  })

  it('兼容仅有 mid 的映射入口，不把领域 id 当作 songID', () => {
    expect(qqLyricIdentifiers(track({ mid: '003a1B2c' })))
      .toEqual({ mid: '003a1B2c', id: undefined })
  })

  it('拒绝混合字符 qqId，避免与正确 MID 指向不同歌曲', () => {
    expect(qqLyricIdentifiers(track({ mid: 'correct-mid', qqId: '12wrong34' })))
      .toEqual({ mid: 'correct-mid', id: undefined })
  })
})
