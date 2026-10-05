import { describe, expect, it } from 'vitest'
import { mapArtistDetail } from './netease-client'

describe('网易云歌手简介', () => {
  it('保留详情接口的简短简介，兼容嵌套歌手对象', () => {
    expect(mapArtistDetail({ artist: { id: 1, name: '歌手', briefDesc: '歌手介绍' } }))
      .toMatchObject({ id: 1, description: '歌手介绍' })
  })
  it('没有简介时保持为空，不从其他实体猜测', () => {
    expect(mapArtistDetail({ id: 1, name: '歌手' }).description).toBe('')
  })
})
