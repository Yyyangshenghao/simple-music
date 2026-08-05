import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __getShuangeRecommendationProfile,
  __resetShuangeRecommendationProfile,
  rankCurrentShuangeCandidates,
  rankShuangeCandidates,
  recordShuangeExposure,
  recordShuangeFeedback,
  seedShuangeTaste,
  stashShuangeCandidates,
  takeShuangeCandidateBatch,
} from './shuange-recommendation'
import type { Track } from '../types/domain'

function track(id: string, artist = id, recommendationHints: string[] = []): Track {
  return {
    provider: 'netease', source: 'netease', type: 'song', id, name: id,
    artist, artists: [{ id: artist, name: artist }], duration: 180_000, recommendationHints,
  }
}

describe('shuange recommendation', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    __resetShuangeRecommendationProfile()
  })

  it('候选去重，并把未曝光曲目排在近期曝光曲目前', () => {
    const result = rankShuangeCandidates(
      [track('old'), track('fresh'), track('fresh')],
      { seenKeys: ['netease:old'], trackScores: {}, artistScores: {} },
      () => 0
    )
    expect(result.map((item) => item.id)).toEqual(['fresh', 'old'])
  })

  it('全部曝光过时优先最久没出现的曲目，不从刚听过的曲目开场', () => {
    const result = rankShuangeCandidates(
      [track('latest'), track('oldest'), track('middle')],
      { seenKeys: ['netease:latest', 'netease:middle', 'netease:oldest'], trackScores: {}, artistScores: {} },
      () => 0
    )
    expect(result[0].id).toBe('oldest')
  })

  it('偏好分能提升喜欢的歌手，同时避免同歌手连续出现', () => {
    const result = rankShuangeCandidates(
      [track('a1', 'A'), track('a2', 'A'), track('b1', 'B')],
      { seenKeys: [], trackScores: {}, artistScores: { 'netease:A': 5 } },
      () => 0
    )
    expect(result.map((item) => item.id)).toEqual(['a1', 'b1', 'a2'])
  })

  it('曝光和播放全曲反馈会影响下一次本地排序', () => {
    const a = track('a', 'A')
    const b = track('b', 'B')
    recordShuangeExposure(a)
    recordShuangeFeedback(b, 'play-full')

    const ranked = rankCurrentShuangeCandidates([a, b])
    expect(ranked[0].id).toBe('b')
  })

  it('口味画像优先常听歌手和风格，但会在靠前位置插入探索候选', () => {
    const result = rankShuangeCandidates(
      [track('rock-1', 'R1', ['摇滚']), track('rock-2', 'R2', ['摇滚']), track('new', 'N'), track('new-2', 'N2')],
      { seenKeys: [], trackScores: {}, artistScores: {}, featureScores: { 'style:rock': 5 } },
      () => 0
    )

    expect(result[0].id).toBe('rock-1')
    expect(result.slice(0, 2).map((item) => item.id)).toContain('new')
  })

  it('负反馈会降低对应歌手和风格的出现优先级，即使随机项取最大值', () => {
    const disliked = track('rock', 'R', ['摇滚'])
    const result = rankShuangeCandidates(
      [disliked, track('other', 'O')],
      { seenKeys: [], trackScores: { 'netease:rock': -3 }, artistScores: { 'netease:R': -1.5 }, featureScores: { 'style:rock': -1 } },
      () => 1
    )

    expect(result[0].id).toBe('other')
  })

  it('明确标记不感兴趣时，比快速划走更强地降低歌曲、歌手和风格权重', () => {
    const target = track('rock', 'R', ['摇滚'])
    recordShuangeFeedback(target, 'not-interested')

    const profile = __getShuangeRecommendationProfile()
    expect(profile.trackScores['netease:rock']).toBe(-5)
    expect(profile.artistScores['netease:R']).toBe(-2.2)
    expect(profile.featureScores?.['style:rock']).toBe(-1.2)
  })

  it('导入常听和收藏曲目，建立歌手与风格画像', () => {
    seedShuangeTaste('netease', [track('ranked', 'A', ['日语'])], [track('liked', 'B', ['摇滚'])])

    const profile = __getShuangeRecommendationProfile()
    expect(profile.artistScores['netease:A']).toBeGreaterThan(0)
    expect(profile.artistScores['netease:B']).toBeGreaterThan(profile.artistScores['netease:A'])
    expect(profile.featureScores?.['language:ja']).toBeGreaterThan(0)
    expect(profile.featureScores?.['style:rock']).toBeGreaterThan(0)
  })

  it('每日重新导入口味时替换账号画像快照，不反复累加同一批歌曲', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-05T12:00:00'))
    const liked = track('liked', 'A', ['摇滚'])
    seedShuangeTaste('netease', [], [liked])
    const first = __getShuangeRecommendationProfile().artistScores['netease:A']

    vi.setSystemTime(new Date('2026-08-06T12:00:00'))
    seedShuangeTaste('netease', [], [liked])

    expect(__getShuangeRecommendationProfile().artistScores['netease:A']).toBe(first)
    vi.useRealTimers()
  })

  it('通用中文歌单名不会将非中文歌曲错误学成华语偏好', () => {
    recordShuangeFeedback(track('unknown', 'Artist', ['私人雷达']), 'like')

    const profile = __getShuangeRecommendationProfile()
    expect(profile.featureScores?.['language:latin']).toBeGreaterThan(0)
    expect(profile.featureScores?.['language:zh']).toBeUndefined()
  })

  it('候选池按批消费并将已发出的歌曲纳入冷却，连续换批不会折返', () => {
    stashShuangeCandidates([track('a'), track('b'), track('c')])

    const first = takeShuangeCandidateBatch('netease', 2)
    const second = takeShuangeCandidateBatch('netease', 2)

    expect(first).toHaveLength(2)
    expect(second).toHaveLength(1)
    expect(new Set([...first, ...second].map((item) => item.id))).toEqual(new Set(['a', 'b', 'c']))
  })

  it('跨日后丢弃候选缓存，避免旧池盖过当天推荐', async () => {
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => key === 'simplemusic-shuange-candidate-cache-v1'
        ? JSON.stringify({ candidates: { netease: [track('stale')] }, cachedOn: { netease: '2000-01-01' } })
        : null,
      setItem: vi.fn(),
    })
    vi.resetModules()
    const recommendation = await import('./shuange-recommendation')

    expect(recommendation.__getShuangeCandidatePool()).toEqual([])
  })

  it('读取旧画像时裁剪曝光列表并丢弃异常分数', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => JSON.stringify({
        seen: { netease: ['netease:a', 42] },
        trackScores: { 'netease:a': 1_000, 'netease:b': Number.POSITIVE_INFINITY },
        artistScores: null,
      }),
      setItem: vi.fn(),
    })
    vi.resetModules()
    const recommendation = await import('./shuange-recommendation')

    const result = recommendation.rankCurrentShuangeCandidates([track('a'), track('b')])

    expect(result[0].id).toBe('b')
    expect(recommendation.__getShuangeRecommendationProfile().seenKeys).toEqual(['netease:a'])
  })
})
