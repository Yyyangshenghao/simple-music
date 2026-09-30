import { describe, expect, it } from 'vitest'
import { isCatalogUnavailable } from './track-availability'
import type { Track } from '../types/domain'

function track(source: Track['source'], playable: boolean): Track {
  return {
    provider: source,
    source,
    type: source,
    id: 'song-id',
    name: '歌曲',
    artist: '歌手',
    artists: [],
    playable,
  }
}

describe('歌手目录版权状态', () => {
  it('只把网易云明确不可播标记视为无版权', () => {
    expect(isCatalogUnavailable(track('netease', false))).toBe(true)
    expect(isCatalogUnavailable(track('qq', false))).toBe(false)
    expect(isCatalogUnavailable(track('apple', false))).toBe(false)
  })
})
