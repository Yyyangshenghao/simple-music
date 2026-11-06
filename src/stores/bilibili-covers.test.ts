import { beforeEach, describe, expect, it, vi } from 'vitest'
import { matchedBilibiliTrack, requestBilibiliCover, seedBilibiliCovers, subscribeCurrentTrackCover, trackCoverOf, useBilibiliCoverStore } from './bilibili-covers'
import { appPlaylistCovers } from '../lib/app-playlist-presentation'
import type { Track } from '../types/domain'
import { usePlayerStore } from './player'

const h = vi.hoisted(() => ({ resolve: vi.fn() }))
vi.mock('../lib/bilibili-song-identity', () => ({ resolveBilibiliSongIdentity: h.resolve }))

const video: Track = { id: 'BV1xx', source: 'bilibili', provider: 'bilibili', type: 'track', artists: [], name: '【4K】周杰伦 - 晴天 MV', videoTitle: '【4K】周杰伦 - 晴天 MV', artist: 'UP', cover: 'https://i0.hdslb.com/video.jpg', duration: 269_000, bilibiliLyricHint: { name: '晴天', artists: ['周杰伦'] } }
const album: Track = { id: 186016, source: 'netease', provider: 'netease', type: 'track', name: '晴天', artist: '周杰伦', artists: [{ id: 6452, name: '周杰伦' }], album: '叶惠美', cover: 'https://p1.music.126.net/album.jpg', duration: 269_000 }

beforeEach(() => {
  requestBilibiliCover(null)
  useBilibiliCoverStore.setState({ entries: {} })
  vi.restoreAllMocks()
  h.resolve.mockReset()
})

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

  it('旧封面缓存不是身份识别结果，新身份只保存安全元数据且随简介或时长失效', () => {
    useBilibiliCoverStore.getState().remember(video, album.cover as string)
    expect(matchedBilibiliTrack(video)).toBeUndefined()
    useBilibiliCoverStore.getState().rememberIdentity(video, { ...album, url: 'temporary', cookie: 'secret' })
    expect(matchedBilibiliTrack(video)).toMatchObject({ id: album.id, name: album.name })
    expect(matchedBilibiliTrack(video)).not.toHaveProperty('url')
    expect(matchedBilibiliTrack(video)).not.toHaveProperty('cookie')
    const changed = { ...video, duration: 200_000 }
    expect(matchedBilibiliTrack(changed)).toBeUndefined()
    expect(trackCoverOf(changed, useBilibiliCoverStore.getState().entries, true)).toBe(video.cover)
    expect(matchedBilibiliTrack({ ...video, bilibiliLyricHint: { name: '夜曲', artists: ['周杰伦'] } })).toBeUndefined()
  })

  it('只浏览列表不识别，当前曲网络失败后连续进度更新不反复请求', async () => {
    const track = { ...video, id: 'BVfailure' }
    h.resolve.mockRejectedValue(new Error('offline'))
    usePlayerStore.setState({ currentTrack: null })
    requestBilibiliCover(track)
    expect(h.resolve).not.toHaveBeenCalled()
    usePlayerStore.setState({ currentTrack: track })
    const stop = subscribeCurrentTrackCover(() => {})
    try {
      await vi.waitFor(() => expect(h.resolve).toHaveBeenCalledOnce())
      for (let position = 1; position < 100; position++) usePlayerStore.setState({ position })
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(h.resolve).toHaveBeenCalledOnce()
    } finally { stop() }
  })

  it('切歌会取消封面识别，快速切回仍允许重新识别', async () => {
    const track = { ...video, id: 'BVcancel' }
    h.resolve.mockImplementation((_track, signal: AbortSignal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true })
    }))
    usePlayerStore.setState({ currentTrack: track })
    const stop = subscribeCurrentTrackCover(() => {})
    try {
      await vi.waitFor(() => expect(h.resolve).toHaveBeenCalledOnce())
      const signal = h.resolve.mock.calls[0][1] as AbortSignal
      usePlayerStore.setState({ currentTrack: null })
      expect(signal.aborted).toBe(true)
      usePlayerStore.setState({ currentTrack: track })
      await vi.waitFor(() => expect(h.resolve).toHaveBeenCalledTimes(2))
    } finally { stop(); requestBilibiliCover(null) }
  })

  it('应用歌单拼贴按歌曲顺序使用替换后的专辑封面', () => {
    useBilibiliCoverStore.getState().remember(video, album.cover as string)
    const { entries } = useBilibiliCoverStore.getState()
    expect(appPlaylistCovers([video], track => trackCoverOf(track, entries, true))[0]?.url).toBe(album.cover)
    expect(appPlaylistCovers([video], track => trackCoverOf(track, entries, false))[0]?.url).toBe(video.cover)
  })
})
