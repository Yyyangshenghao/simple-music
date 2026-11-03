import { describe, expect, it } from 'vitest'
import { mapArtists } from './netease-client'
import { mapQQTrack } from './qq-client'

describe('歌手别名映射', () => {
  it('网易云带上 alias 与 tns，去重且不含本名；没有别名时省略字段', () => {
    expect(mapArtists([
      { id: 2116, name: '陈奕迅', alias: ['Eason Chan', '陈奕迅'], tns: ['Eason Chan'] },
      { id: 1, name: '某人', alias: [] },
    ])).toEqual([{ id: 2116, name: '陈奕迅', aliases: ['Eason Chan'] }, { id: 1, name: '某人' }])
  })

  it('QQ 从 title 的括注取外文名，title 与本名一致时不带别名', () => {
    const track = mapQQTrack({ mid: 'm1', name: '晴天', singer: [
      { mid: 's1', id: 4558, name: '周杰伦', title: '周杰伦 (Jay Chou)' },
      { mid: 's2', id: 13948, name: 'G.E.M.邓紫棋', title: 'G.E.M.邓紫棋' },
    ] }, {})
    expect(track.artists).toEqual([
      expect.objectContaining({ name: '周杰伦', aliases: ['Jay Chou'] }),
      expect.not.objectContaining({ aliases: expect.anything() }),
    ])
  })
})
