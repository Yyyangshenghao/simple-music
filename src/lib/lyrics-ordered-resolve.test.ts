import { describe, expect, it } from 'vitest'
import { lyricsOriginOrder } from './lyrics-ordered-resolve'
import type { Track } from '../types/domain'

const order = ['netease', 'qq', 'amll', 'kugou'] as const
const track = (source: Track['source']): Track => ({ id: '1', name: '晴天', artist: '周杰伦', source, provider: source } as Track)

describe('歌词来源查询顺序', () => {
  it('本地歌曲先查本地，再按用户顺序查在线来源；记住的来源排最前', () => {
    expect(lyricsOriginOrder(track('local'), order)).toEqual(['local', 'netease', 'qq', 'amll', 'kugou'])
    expect(lyricsOriginOrder(track('local'), order, { origin: 'qq', name: '晴天', artist: '周杰伦' }))
      .toEqual(['qq', 'local', 'netease', 'amll', 'kugou'])
  })

  it('Apple 曲目先查自带歌词，在线曲目按用户顺序', () => {
    expect(lyricsOriginOrder(track('apple'), order)).toEqual(['apple', ...order])
    expect(lyricsOriginOrder(track('qq'), order)).toEqual([...order])
  })
})
