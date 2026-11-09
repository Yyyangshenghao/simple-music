import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OnlineMusicSource, Track } from '../types/domain'

const transportMocks = vi.hoisted(() => ({
  fetchTrackQualities: vi.fn(),
  resolveSongUrl: vi.fn(),
}))

vi.mock('../lib/track-qualities', () => ({
  fetchTrackQualities: transportMocks.fetchTrackQualities,
}))

vi.mock('../lib/track-preload', () => ({
  resolveSongUrl: transportMocks.resolveSongUrl,
}))

import { listProviders } from './registry'
import { qqProvider } from './qq-provider'
import type { QQMusicService } from '../lib/qq-music-service'

function trackFor(source: OnlineMusicSource): Track {
  return {
    provider: source,
    source,
    type: 'song',
    id: `${source}-track`,
    name: `${source} track`,
    artist: 'artist',
    artists: [],
  }
}

it('QQ每日推荐与电台分别转发，最近歌曲不伪装歌单/周排行', async () => {
  const service = qqProvider.legacyService as QQMusicService
  const daily = vi.spyOn(service, 'getDailySongs').mockResolvedValue([])
  const radio = vi.spyOn(service, 'getRadioSongs').mockResolvedValue([])
  const recent = vi.spyOn(service, 'getRecentTracks').mockResolvedValue([trackFor('qq')])
  try {
    await qqProvider.recommendations!.load('qq:daily')
    expect(daily).toHaveBeenCalledTimes(1)
    expect(radio).not.toHaveBeenCalled()
    await qqProvider.recommendations!.load('qq:radio')
    expect(radio).toHaveBeenCalledTimes(1)
    expect(await qqProvider.history!.getRecentTracks!()).toEqual([trackFor('qq')])
    expect(recent).toHaveBeenCalledTimes(1)
  } finally { vi.restoreAllMocks() }
})

describe.each(listProviders())('$descriptor.id provider contract', (provider) => {
  afterEach(() => {
    vi.restoreAllMocks()
    transportMocks.fetchTrackQualities.mockReset()
    transportMocks.resolveSongUrl.mockReset()
  })

  it('catalog 和歌词能力转发到同一 legacy service', async () => {
    const track = trackFor(provider.descriptor.id)
    const searchTracks = vi.spyOn(provider.legacyService, 'searchTracks').mockResolvedValue([track])
    const getLyrics = vi.spyOn(provider.legacyService, 'getLyrics').mockResolvedValue([
      { time: 0, text: 'lyric' },
    ])

    await expect(provider.catalog.searchTracks('keyword')).resolves.toEqual([track])
    expect(searchTracks).toHaveBeenCalledWith('keyword')
    if (provider.descriptor.id === 'bilibili') return // 兜底平台没有歌词，沿用原曲目
    await expect(provider.playback.getLyrics(track)).resolves.toEqual([{ time: 0, text: 'lyric' }])
    expect(getLyrics).toHaveBeenCalled()
  })

  it('在 provider 边界修正 legacy 实体的来源字段', async () => {
    const legacyTrack = { ...trackFor(provider.descriptor.id), provider: 'local', source: 'local' } as Track
    vi.spyOn(provider.legacyService, 'searchTracks').mockResolvedValue([legacyTrack])

    await expect(provider.catalog.searchTracks('keyword')).resolves.toEqual([
      expect.objectContaining({
        provider: provider.descriptor.id,
        source: provider.descriptor.id,
      }),
    ])
  })

  it('播放能力统一音质和 URL 解析结果', async () => {
    const track = trackFor(provider.descriptor.id)
    if (provider.descriptor.id === 'apple') {
      await expect(provider.playback.getQualities(track)).resolves.toEqual([{ id: 'standard', label: 'Apple Music', rank: 0 }])
      await expect(provider.playback.resolve(track, 'max')).resolves.toMatchObject([{ url: 'apple-music:apple-track', trial: false }])
      expect(transportMocks.resolveSongUrl).not.toHaveBeenCalled()
      return
    }
    if (provider.descriptor.id === 'bilibili') return // 独立用例覆盖多节点候选
    transportMocks.fetchTrackQualities.mockResolvedValue([
      { level: 'lossless', label: '无损', br: 999000 },
    ])
    transportMocks.resolveSongUrl.mockResolvedValue({
      url: 'https://example.test/audio',
      level: 'exhigh',
      quality: '极高',
      trial: true,
    })

    await expect(provider.playback.getQualities(track)).resolves.toEqual([
      { id: 'lossless', label: '无损', rank: 0, bitrate: 999000 },
    ])
    await expect(provider.playback.resolve(track, 'max')).resolves.toEqual([
      {
        source: provider.descriptor.id,
        track,
        quality: { id: 'exhigh', label: '极高', rank: 0 },
        url: 'https://example.test/audio',
        trial: true,
      },
    ])
    expect(transportMocks.fetchTrackQualities).toHaveBeenCalledWith(track)
    expect(transportMocks.resolveSongUrl).toHaveBeenCalledWith(track, 'max', undefined)
  })

  it('播放受限时保留平台提示供解析器最终展示', async () => {
    if (provider.descriptor.id === 'apple' || provider.descriptor.id === 'bilibili') return // 各自运行期报告播放限制
    const track = trackFor(provider.descriptor.id)
    transportMocks.resolveSongUrl.mockResolvedValue({
      url: '',
      restriction: { message: '当前账号需要会员' },
    })
    await expect(provider.playback.resolve(track, 'lossless')).rejects.toMatchObject({
      name: 'PlaybackUnavailableError',
      message: '当前账号需要会员',
      reason: 'restricted',
    })
  })

  // 游客音源没有推荐歌单栏目。
  it.skipIf(!provider.recommendations?.listSurfaces().some(surface => surface.kind === 'playlist-feed'))('推荐歌单栏目统一分页结果', async () => {
    const playlistFeed = provider.recommendations!
      .listSurfaces()
      .find((surface) => surface.kind === 'playlist-feed')!
    const getRecommendPlaylists = vi
      .spyOn(provider.legacyService, 'getRecommendPlaylists')
      .mockResolvedValue([])

    await expect(provider.recommendations!.load(playlistFeed.id, '2')).resolves.toEqual({
      content: { type: 'playlists', playlists: [] },
      nextCursor: undefined,
      hasMore: false,
    })
    expect(getRecommendPlaylists).toHaveBeenCalledWith(2)
  })
})

describe('bilibili 兜底播放', () => {
  afterEach(() => vi.restoreAllMocks())

  it('一次给出所有节点，高档在前，档位按音质去重', async () => {
    const { bilibiliProvider, bilibiliService } = await import('./bilibili-provider')
    const track = { ...trackFor('bilibili'), id: 'BV1BZbSzZEGT', bvid: 'BV1BZbSzZEGT' }
    vi.spyOn(bilibiliService, 'getPlayInfo').mockResolvedValue({
      candidates: [
        { url: 'https://upos-a.bilivideo.com/1.m4s', level: 'exhigh', quality: '192K', br: 192000 },
        { url: 'https://upos-b.bilivideo.com/1.m4s', level: 'exhigh', quality: '192K', br: 192000 },
        { url: 'https://upos-a.bilivideo.com/2.m4s', level: 'standard', quality: '64K', br: 64000 },
      ],
      expiresAt: 123,
    })
    await expect(bilibiliProvider.playback.getQualities(track)).resolves.toEqual([
      { id: 'exhigh', label: '192K', rank: 0, bitrate: 192000 },
      { id: 'standard', label: '64K', rank: 1, bitrate: 64000 },
    ])
    const candidates = await bilibiliProvider.playback.resolve(track, 'lossless')
    expect(candidates.map((item) => [item.source, item.quality.id, item.quality.rank, item.url, item.trial, item.expiresAt])).toEqual([
      ['bilibili', 'exhigh', 0, 'https://upos-a.bilivideo.com/1.m4s', false, 123],
      ['bilibili', 'exhigh', 0, 'https://upos-b.bilivideo.com/1.m4s', false, 123],
      ['bilibili', 'standard', 1, 'https://upos-a.bilivideo.com/2.m4s', false, 123],
    ])
    await expect(bilibiliProvider.playback.getLyrics(track)).resolves.toEqual([])
    expect(transportMocks.resolveSongUrl).not.toHaveBeenCalled()
  })

  it('没有音频时报告不可播放，交给解析器继续', async () => {
    const { bilibiliProvider, bilibiliService } = await import('./bilibili-provider')
    vi.spyOn(bilibiliService, 'getPlayInfo').mockResolvedValue({ candidates: [], expiresAt: 0 })
    await expect(bilibiliProvider.playback.resolve(trackFor('bilibili'), 'max')).rejects.toMatchObject({ name: 'PlaybackUnavailableError' })
  })
})
