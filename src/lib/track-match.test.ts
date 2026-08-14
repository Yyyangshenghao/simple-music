import { beforeEach, describe, expect, it, vi } from 'vitest'
import { providerFor } from '../providers/registry'
import type { Track } from '../types/domain'
import {
  clearTrackMatchCache,
  findEquivalentTrack,
  matchBestTrack,
  normalizeMatchText,
  scoreTrackMatch,
} from './track-match'

function track(partial: Partial<Track> = {}): Track {
  return {
    provider: 'netease',
    source: 'netease',
    type: 'song',
    id: 'n-1',
    name: '晴天',
    artist: '周杰伦',
    artists: [{ id: 1, name: '周杰伦' }],
    album: '叶惠美',
    duration: 269_000,
    ...partial,
  }
}

describe('track match', () => {
  beforeEach(() => {
    const values: Record<string, string> = {}
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values[key] ?? null,
      setItem: (key: string, value: string) => { values[key] = value },
      removeItem: (key: string) => { delete values[key] },
    })
    clearTrackMatchCache()
    vi.restoreAllMocks()
  })

  it('归一化宽字符、大小写、标点和空白', () => {
    expect(normalizeMatchText('Ｍｏｊｉｔｏ （Live）！')).toBe('mojitolive')
  })

  it('标题与主要艺人一致即达到自动匹配阈值', () => {
    expect(scoreTrackMatch(track({ duration: undefined, album: undefined }), track({
      source: 'qq',
      provider: 'qq',
      id: 'q-1',
      duration: undefined,
      album: undefined,
    }))).toBe(80)
  })

  it('艺人主名一致时兼容平台附加的括注别名', () => {
    const qq = track({
      source: 'qq',
      provider: 'qq',
      id: 'q-alias',
      name: '假装我们不需要呼吸',
      artist: '方拾贰',
      artists: [{ id: 1, name: '方拾贰' }],
      album: '假装我们不需要呼吸',
      duration: 244_000,
    })
    const netease = track({
      id: 'n-alias',
      name: '假装我们不需要呼吸',
      artist: '方拾贰（方十二）',
      artists: [{ id: 2, name: '方拾贰（方十二）' }],
      album: '假装我们不需要呼吸',
      duration: 244_000,
    })

    expect(scoreTrackMatch(qq, netease)).toBe(100)
    expect(scoreTrackMatch(qq, track({
      ...netease,
      artist: '玄舸（方拾贰）',
      artists: [{ id: 3, name: '玄舸（方拾贰）' }],
    }))).toBeNull()
  })

  it('不会移除艺人名开头的必要括号内容', () => {
    expect(scoreTrackMatch(track({
      artist: '(G)I-DLE',
      artists: [{ id: 1, name: '(G)I-DLE' }],
    }), track({
      source: 'qq',
      provider: 'qq',
      id: 'q-parenthesized',
      artist: 'GIDLE',
      artists: [{ id: 2, name: 'GIDLE' }],
    }))).toBe(100)
  })

  it('ISRC 一致且基础标题一致直接得到 100 分', () => {
    expect(scoreTrackMatch(track({ isrc: 'CN-A01-23-12345' }), track({
      source: 'qq',
      provider: 'qq',
      id: 'q-1',
      isrc: 'cn-a01-23-12345',
    }))).toBe(100)
  })

  it.each([
    ['版本标签冲突', track({ name: '晴天 (Live)' })],
    ['主要艺人无交集', track({ artist: '翻唱歌手', artists: [{ id: 2, name: '翻唱歌手' }] })],
    ['时长相差超过三秒', track({ duration: 272_001 })],
  ])('%s 时拒绝自动匹配', (_name, candidate) => {
    expect(scoreTrackMatch(track(), candidate)).toBeNull()
  })

  it('从候选中选择分数最高且达到阈值的曲目', () => {
    const basic = track({ source: 'qq', provider: 'qq', id: 'basic', duration: undefined, album: undefined })
    const exact = track({ source: 'qq', provider: 'qq', id: 'exact' })
    expect(matchBestTrack(track(), [basic, exact])).toEqual({ track: exact, score: 100 })
  })

  it('命中缓存后复用去除临时 URL 的目标快照，不重复搜索', async () => {
    const provider = providerFor('qq')
    const matched = track({ source: 'qq', provider: 'qq', id: 'q-cache', url: 'https://expired.test/audio' })
    const search = vi.spyOn(provider.catalog, 'searchTracks').mockResolvedValue([matched])
    const getByIds = vi.spyOn(provider.catalog, 'getTracksByIds').mockResolvedValue([matched])

    await expect(findEquivalentTrack(track(), 'qq', undefined, 1000)).resolves.toEqual({
      track: expect.objectContaining({ id: 'q-cache' }),
      score: 100,
    })
    await expect(findEquivalentTrack(track(), 'qq', undefined, 1001)).resolves.toEqual({
      track: expect.not.objectContaining({ url: expect.anything() }),
      score: 100,
    })
    expect(search).toHaveBeenCalledTimes(1)
    expect(getByIds).not.toHaveBeenCalled()
  })

  it('未命中使用 24 小时负缓存', async () => {
    const provider = providerFor('qq')
    const search = vi.spyOn(provider.catalog, 'searchTracks').mockResolvedValue([])
    await expect(findEquivalentTrack(track(), 'qq', undefined, 1000)).resolves.toBeNull()
    await expect(findEquivalentTrack(track(), 'qq', undefined, 1001)).resolves.toBeNull()
    expect(search).toHaveBeenCalledTimes(1)
  })

  it('匹配规则升级后忽略旧版负缓存并重新搜索', async () => {
    localStorage.setItem('simplemusic-track-match-cache', JSON.stringify({
      schema: 1,
      entries: {
        'netease:n-1->qq': { verifiedAt: 1000, expiresAt: 86_401_000 },
      },
    }))
    const provider = providerFor('qq')
    const matched = track({ source: 'qq', provider: 'qq', id: 'q-refreshed' })
    const search = vi.spyOn(provider.catalog, 'searchTracks').mockResolvedValue([matched])

    await expect(findEquivalentTrack(track(), 'qq', undefined, 1001)).resolves.toEqual({
      track: matched,
      score: 100,
    })
    expect(search).toHaveBeenCalledTimes(1)
  })
})
