import { describe, expect, it, vi } from 'vitest'
import type { MusicProvider, PlaybackCandidate, ProviderId, QualityOption } from '../providers/types'
import { PlaybackUnavailableError } from '../providers/types'
import type { AudioQuality, Track } from '../types/domain'
import { buildPlaybackSourceOrder, PlaybackResolver } from './playback-resolver'

function track(source: ProviderId, id = `${source}-1`): Track {
  return {
    provider: source,
    source,
    type: 'song',
    id,
    name: '晴天',
    artist: '周杰伦',
    artists: [{ id: 1, name: '周杰伦' }],
    duration: 269_000,
  }
}

function quality(id: string, rank = 0): QualityOption {
  return { id, label: id, rank }
}

function candidate(source: ProviderId, url: string, level = 'exhigh'): PlaybackCandidate {
  return {
    source,
    track: track(source),
    quality: quality(level),
    url,
    trial: false,
  }
}

function dependencies(options: {
  active?: ProviderId[]
  resolve: Record<ProviderId, (track: Track, quality: AudioQuality, signal?: AbortSignal) => Promise<PlaybackCandidate[]>>
  qualities?: Partial<Record<ProviderId, QualityOption[]>>
  matches?: Partial<Record<ProviderId, Track | null>>
}) {
  const active = new Set(options.active ?? ['netease', 'qq'])
  return {
    isParticipating: (source: ProviderId) => active.has(source),
    provider: (source: ProviderId) => ({
      playback: {
        resolve: options.resolve[source],
        getQualities: vi.fn(async () => options.qualities?.[source] ?? []),
      },
    } as unknown as MusicProvider),
    match: vi.fn(async (_origin: Track, target: ProviderId) => {
      const matched = options.matches?.[target]
      return matched ? { track: matched, score: 100 } : null
    }),
    active,
  }
}

describe('buildPlaybackSourceOrder', () => {
  const participating = () => true

  it('手动软优先在最前，其后是原源和全局顺序', () => {
    expect(buildPlaybackSourceOrder(track('netease'), {
      playbackOrder: ['netease', 'qq'],
      preferOriginSource: true,
      multiSourceFallback: true,
      preferredSource: 'qq',
    }, participating)).toEqual(['qq', 'netease'])
  })

  it('关闭原源优先时严格按全局顺序', () => {
    expect(buildPlaybackSourceOrder(track('netease'), {
      playbackOrder: ['qq', 'netease'],
      preferOriginSource: false,
      multiSourceFallback: true,
    }, participating)).toEqual(['qq', 'netease'])
  })

  it('关闭跨源降级只保留首个平台，并过滤未参与平台', () => {
    expect(buildPlaybackSourceOrder(track('netease'), {
      playbackOrder: ['netease', 'qq'],
      preferOriginSource: true,
      multiSourceFallback: false,
      preferredSource: 'qq',
    }, (source) => source === 'netease')).toEqual(['netease'])
  })
})

describe('PlaybackResolver', () => {
  const preferences = {
    playbackOrder: ['netease', 'qq'] as ProviderId[],
    preferOriginSource: true,
    multiSourceFallback: true,
  }

  it('媒体失败后先尝试同平台下一地址，再跨平台', async () => {
    const deps = dependencies({
      resolve: {
        netease: vi.fn(async () => [candidate('netease', 'n-a'), candidate('netease', 'n-b')]),
        qq: vi.fn(async () => [candidate('qq', 'q-a')]),
      },
      matches: { qq: track('qq') },
    })
    const resolver = new PlaybackResolver(track('netease'), 'exhigh', preferences, deps)

    await expect(resolver.next()).resolves.toEqual(expect.objectContaining({ url: 'n-a' }))
    await expect(resolver.next('decode failed')).resolves.toEqual(expect.objectContaining({ url: 'n-b' }))
    await expect(resolver.next('cdn failed')).resolves.toEqual(expect.objectContaining({ source: 'qq', url: 'q-a' }))
    expect(resolver.attempts.map((attempt) => `${attempt.stage}:${attempt.source}:${attempt.result}`)).toEqual([
      'resolve:netease:success',
      'media-load:netease:error',
      'media-load:netease:error',
      'match:qq:success',
      'resolve:qq:success',
    ])
  })

  it('当前请求档不可用时按探测结果有限降质', async () => {
    const resolve = vi.fn(async (_track: Track, level: AudioQuality) => (
      level === 'standard' ? [candidate('netease', 'standard-url', 'standard')] : []
    ))
    const deps = dependencies({
      resolve: { netease: resolve, qq: vi.fn(async () => []) },
      qualities: { netease: [quality('exhigh'), quality('standard', 1)] },
    })
    const resolver = new PlaybackResolver(track('netease'), 'exhigh', {
      ...preferences,
      playbackOrder: ['netease'],
    }, deps)

    await expect(resolver.next()).resolves.toEqual(expect.objectContaining({ url: 'standard-url' }))
    expect(resolve.mock.calls.map((call) => call[1])).toEqual(['exhigh', 'standard'])
  })

  it('切歌取消后丢弃迟到解析，不再产出候选', async () => {
    let release!: (value: PlaybackCandidate[]) => void
    const pending = new Promise<PlaybackCandidate[]>((resolve) => { release = resolve })
    const deps = dependencies({
      resolve: { netease: vi.fn(() => pending), qq: vi.fn(async () => []) },
    })
    const resolver = new PlaybackResolver(track('netease'), 'exhigh', preferences, deps)
    const resolving = resolver.next()
    resolver.abort()
    release([candidate('netease', 'late')])
    await expect(resolving).resolves.toBeNull()
  })

  it('候选 canplay 后才提交实际来源与听歌上报目标', async () => {
    const deps = dependencies({
      resolve: { netease: vi.fn(async () => [candidate('netease', 'n-a')]), qq: vi.fn(async () => []) },
    })
    const resolver = new PlaybackResolver(track('netease'), 'lossless', preferences, deps)
    const found = await resolver.next()
    expect(found).not.toBeNull()
    const resolution = resolver.complete(found!)
    expect(resolution).toEqual(expect.objectContaining({
      actualSource: 'netease',
      resolvedTrack: expect.objectContaining({ source: 'netease' }),
      scrobbleTarget: { source: 'netease', trackId: 'netease-1' },
    }))
    expect(resolution?.attempts.at(-1)?.stage).toBe('media-load')
    expect(resolution?.attempts.at(-1)?.result).toBe('success')
  })

  it('解析途中平台失效后不继续请求该平台', async () => {
    const resolve = vi.fn(async () => [candidate('netease', 'n-a')])
    const deps = dependencies({
      resolve: { netease: resolve, qq: vi.fn(async () => []) },
    })
    deps.active.delete('netease')
    const resolver = new PlaybackResolver(track('netease'), 'exhigh', preferences, deps)
    await expect(resolver.next()).resolves.toBeNull()
    expect(resolve).not.toHaveBeenCalled()
  })

  it('平台在 URL 响应返回前失效时丢弃该响应', async () => {
    let release!: (value: PlaybackCandidate[]) => void
    const pending = new Promise<PlaybackCandidate[]>((resolve) => { release = resolve })
    const deps = dependencies({
      resolve: { netease: vi.fn(() => pending), qq: vi.fn(async () => []) },
    })
    const resolver = new PlaybackResolver(track('netease'), 'exhigh', preferences, deps)
    const resolving = resolver.next()
    deps.active.delete('netease')
    release([candidate('netease', 'late')])
    await expect(resolving).resolves.toBeNull()
  })

  it('达到最大尝试数后停止，不会遍历无界地址', async () => {
    const deps = dependencies({
      resolve: {
        netease: vi.fn(async () => [
          candidate('netease', 'n-1'),
          candidate('netease', 'n-2'),
          candidate('netease', 'n-3'),
        ]),
        qq: vi.fn(async () => []),
      },
    })
    const resolver = new PlaybackResolver(track('netease'), 'exhigh', preferences, deps, 3)
    await expect(resolver.next()).resolves.toEqual(expect.objectContaining({ url: 'n-1' }))
    await expect(resolver.next('failed-1')).resolves.toEqual(expect.objectContaining({ url: 'n-2' }))
    await expect(resolver.next('failed-2')).resolves.toEqual(expect.objectContaining({ url: 'n-3' }))
    await expect(resolver.next('failed-3')).resolves.toBeNull()
    expect(resolver.attempts.filter((attempt) => attempt.stage === 'media-load')).toHaveLength(3)
  })

  it('保留平台受限原因作为候选耗尽后的最终提示', async () => {
    const deps = dependencies({
      resolve: {
        netease: vi.fn(async () => { throw new PlaybackUnavailableError('需要网易云会员', 'restricted') }),
        qq: vi.fn(async () => []),
      },
    })
    const resolver = new PlaybackResolver(track('netease'), 'lossless', {
      ...preferences,
      playbackOrder: ['netease'],
    }, deps)
    await expect(resolver.next()).resolves.toBeNull()
    expect(resolver.failureMessage).toBe('需要网易云会员')
    expect(resolver.attempts[0]).toEqual(expect.objectContaining({ result: 'restricted' }))
  })
})
