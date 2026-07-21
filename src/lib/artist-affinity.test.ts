import { describe, expect, it } from 'vitest'
import { rankArtistsByFrequency } from './artist-affinity'
import type { Track } from '../types/domain'

function track(artists: { id: unknown; name: string }[]): Track {
  return {
    provider: 'netease',
    source: 'netease',
    type: 'song',
    id: Math.random(),
    name: 't',
    artist: artists.map((a) => a.name).join('/'),
    artists,
  }
}

describe('rankArtistsByFrequency', () => {
  it('按出现次数降序，跨多批曲目合并计数', () => {
    const a = { id: 1, name: 'A' }
    const b = { id: 2, name: 'B' }
    const liked = [track([a]), track([a]), track([b])]
    const ranking = [track([a]), track([b]), track([b])]
    const result = rankArtistsByFrequency([liked, ranking])
    expect(result).toEqual([
      { id: 1, name: 'A', count: 3 },
      { id: 2, name: 'B', count: 3 },
    ])
  })

  it('缺少 id 或 name 的歌手被跳过', () => {
    const result = rankArtistsByFrequency([[track([{ id: undefined, name: 'X' }]), track([{ id: 3, name: '' }])]])
    expect(result).toEqual([])
  })

  it('按 limit 截断', () => {
    const tracks = [track([{ id: 1, name: 'A' }]), track([{ id: 2, name: 'B' }]), track([{ id: 3, name: 'C' }])]
    const result = rankArtistsByFrequency([tracks], 2)
    expect(result).toHaveLength(2)
  })
})
