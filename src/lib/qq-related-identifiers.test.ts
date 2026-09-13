import { describe, expect, it } from 'vitest'
import type { Track } from '../types/domain'
import { qqRelatedSongId } from './qq-related-identifiers'

const track: Track = { provider: 'qq', source: 'qq', type: 'qq', id: 'song-mid', name: '歌曲', artist: '', artists: [] }

describe('qqRelatedSongId', () => {
  it('只从真实 qqId 获取数字 ID，支持数字字符串', () => {
    expect(qqRelatedSongId({ ...track, qqId: 5105986 })).toBe(5105986)
    expect(qqRelatedSongId({ ...track, qqId: '5105986' })).toBe(5105986)
    expect(qqRelatedSongId({ ...track, id: 5105986 })).toBeNull()
  })
  it('拒绝其他来源、pending、缺失或非法 ID', () => {
    expect(qqRelatedSongId(null)).toBeNull()
    expect(qqRelatedSongId({ ...track, source: 'netease', qqId: 1 })).toBeNull()
    expect(qqRelatedSongId({ ...track, pending: true, qqId: 1 })).toBeNull()
    for (const qqId of [undefined, '', true, {}, 0, -1, 1.2, 'mid123', '1e3', '9007199254740993']) {
      expect(qqRelatedSongId({ ...track, qqId })).toBeNull()
    }
  })
})
