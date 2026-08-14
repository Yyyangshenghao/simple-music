import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Track } from '../types/domain'

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

function trackFor(source: 'netease' | 'qq'): Track {
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
    await expect(provider.playback.getLyrics(track)).resolves.toEqual([{ time: 0, text: 'lyric' }])
    expect(searchTracks).toHaveBeenCalledWith('keyword')
    expect(getLyrics).toHaveBeenCalledWith(track)
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

  it('推荐歌单栏目统一分页结果', async () => {
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
