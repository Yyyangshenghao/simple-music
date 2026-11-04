import { beforeEach, describe, expect, it } from 'vitest'
import { seedBilibiliCovers, trackCoverOf, useBilibiliCoverStore } from './bilibili-covers'
import type { Track } from '../types/domain'

const video: Track = { id: 'BV1xx', source: 'bilibili', name: '【4K】周杰伦 - 晴天 MV', videoTitle: '【4K】周杰伦 - 晴天 MV', artist: 'UP', cover: 'https://i0.hdslb.com/video.jpg', duration: 269_000, bilibiliLyricHint: { name: '晴天', artists: ['周杰伦'] } }
const album: Track = { id: 186016, source: 'netease', name: '晴天', artist: '周杰伦', artists: [{ id: 6452, name: '周杰伦' }], album: '叶惠美', cover: 'https://p1.music.126.net/album.jpg', duration: 269_000 }

beforeEach(() => useBilibiliCoverStore.setState({ entries: {} }))

describe('哔哩哔哩专辑封面', () => {
  it('匹配前与关闭开关时显示视频封面，匹配后显示专辑封面', () => {
    expect(trackCoverOf(video, {}, true)).toBe(video.cover)
    useBilibiliCoverStore.getState().remember(video, album.cover as string)
    const { entries } = useBilibiliCoverStore.getState()
    expect(trackCoverOf(video, entries, true)).toBe(album.cover)
    expect(trackCoverOf(video, entries, false)).toBe(video.cover)
    expect(trackCoverOf(album, entries, true)).toBe(album.cover)
  })

  it('未找到同曲时仍用视频封面', () => {
    useBilibiliCoverStore.getState().remember(video, '')
    expect(trackCoverOf(video, useBilibiliCoverStore.getState().entries, true)).toBe(video.cover)
  })

  it('聚合搜索结果里的同曲直接补封面，时长不符的候选不采用', async () => {
    await seedBilibiliCovers([video], [{ ...album, duration: 200_000 }])
    expect(useBilibiliCoverStore.getState().entries['bilibili:BV1xx']).toBeUndefined()
    await seedBilibiliCovers([video], [album])
    expect(useBilibiliCoverStore.getState().entries['bilibili:BV1xx']?.cover).toBe(album.cover)
  })
})
