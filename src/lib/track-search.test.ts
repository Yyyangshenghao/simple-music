import { describe, expect, it } from 'vitest'
import { matchingTrackIndices } from './track-search'
import { buildQueue } from './lazy-window'
import type { Track } from '../types/domain'

const tracks: (Track | null)[] = [
  { source: 'netease', provider: 'netease', type: 'song', id: 1, name: '晴天', artist: '周杰伦', artists: [{ id: 1, name: '周杰伦' }] },
  null,
  { source: 'qq', provider: 'qq', type: 'song', id: '2', name: 'Love Story', artist: 'Taylor Swift', artists: [{ id: 2, name: 'Taylor Swift' }, { id: 3, name: '合作歌手' }] },
]

describe('列表内搜索', () => {
  it('按歌名匹配，忽略前后空格和英文大小写', () => {
    expect(matchingTrackIndices(tracks, '晴')).toEqual([0])
    expect(matchingTrackIndices(tracks, ' LOVE ')).toEqual([2])
  })
  it('歌单搜索包含歌手和合作歌手，歌手页面只匹配歌名', () => {
    expect(matchingTrackIndices(tracks, '周杰伦', true)).toEqual([0])
    expect(matchingTrackIndices(tracks, '合作', true)).toEqual([2])
    expect(matchingTrackIndices(tracks, '周杰伦')).toEqual([])
  })
  it('保留完整队列下标，筛选后的第一首仍定位原第三首', () => {
    const queue = buildQueue([1, 99, '2'], tracks, 'netease')
    const indices = matchingTrackIndices(tracks, 'story', true)
    expect(queue[indices[0]]).toBe(tracks[2])
    expect(queue).toHaveLength(3)
  })
  it('空搜索恢复已加载歌曲，缺失和占位条目不参与匹配', () => {
    expect(matchingTrackIndices(tracks, '   ')).toEqual([0, 2])
    expect(matchingTrackIndices([{ ...tracks[0]!, pending: true }], '晴')).toEqual([])
    expect(matchingTrackIndices(tracks, '不存在')).toEqual([])
  })
})
