import { afterEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ cloudsearch: vi.fn() }))
vi.mock('NeteaseCloudMusicApi', () => ({ default: { cloudsearch: h.cloudsearch } }))
import { handleArtistSearch, mapArtistDetail } from './netease-client'

afterEach(() => vi.resetAllMocks())

describe('网易云歌手头像', () => {
  it('搜索头像与详情保持一致，不把封面 picUrl 当作头像', async () => {
    h.cloudsearch.mockResolvedValue({ status: 200, cookie: [], body: { result: { artists: [{
      id: 6452, name: '周杰伦', picUrl: 'https://p3.music.126.net/cover.jpg',
      img1v1Url: 'https://p3.music.126.net/avatar.jpg', musicSize: 568,
    }] } } })
    const artists = await handleArtistSearch('周杰伦', 5, '')
    const detail = mapArtistDetail({ artist: {
      id: 6452, name: '周杰伦', cover: 'https://p3.music.126.net/cover.jpg',
      avatar: 'https://p3.music.126.net/avatar.jpg',
    } })
    expect(artists[0]).toMatchObject({ id: 6452, name: '周杰伦', musicSize: 568, avatar: detail.avatar })
    expect(detail.cover).toBe('https://p3.music.126.net/cover.jpg')
  })

  it.each([
    [{ avatar: 'avatar.jpg', img1v1Url: 'square.jpg', picUrl: 'cover.jpg' }, 'avatar.jpg'],
    [{ img1v1Url: 'square.jpg', picUrl: 'cover.jpg' }, 'square.jpg'],
    [{ picUrl: 'cover.jpg' }, 'cover.jpg'],
    [{}, ''],
  ])('搜索和详情使用相同的头像优先级与缺图回退：%j', async (images, expected) => {
    const artist = { id: 1, name: '歌手', ...images }
    h.cloudsearch.mockResolvedValue({ status: 200, cookie: [], body: { result: { artists: [artist] } } })
    expect((await handleArtistSearch('歌手', 5, ''))[0].avatar).toBe(expected)
    expect(mapArtistDetail(artist).avatar).toBe(expected)
  })
})

describe('网易云歌手封面', () => {
  it('保留旧接口的封面字段，不从头像猜测封面', () => {
    expect(mapArtistDetail({ picUrl: 'cover.jpg', img1v1Url: 'avatar.jpg' }))
      .toMatchObject({ cover: 'cover.jpg', avatar: 'avatar.jpg' })
    expect(mapArtistDetail({ avatar: 'avatar.jpg' }).cover).toBe('')
  })
})

describe('网易云歌手简介', () => {
  it('保留详情接口的简短简介，兼容嵌套歌手对象', () => {
    expect(mapArtistDetail({ artist: { id: 1, name: '歌手', briefDesc: '歌手介绍' } }))
      .toMatchObject({ id: 1, description: '歌手介绍' })
  })
  it('没有简介时保持为空，不从其他实体猜测', () => {
    expect(mapArtistDetail({ id: 1, name: '歌手' }).description).toBe('')
  })
})
