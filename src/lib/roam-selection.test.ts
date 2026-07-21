import { describe, it, expect, vi, afterEach } from 'vitest'
import { shuffle, pickArtistTracks, buildRoamTracks, computeDefaultSongCount } from './roam-selection'
import type { Track } from '../types/domain'

function mkTrack(artistId: number, i: number): Track {
  return {
    provider: 'netease',
    source: 'netease',
    type: 'song',
    id: `${artistId}-${i}`,
    name: `t${artistId}-${i}`,
    artist: '',
    artists: [],
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('shuffle', () => {
  it('不修改入参,返回新数组', () => {
    const input = [1, 2, 3]
    const out = shuffle(input)
    expect(input).toEqual([1, 2, 3])
    expect(out).not.toBe(input)
  })

  it('保留全部元素(多重集相等)', () => {
    const input = [1, 2, 3, 4, 5]
    const out = shuffle(input)
    expect(out.slice().sort()).toEqual(input.slice().sort())
  })

  it('按 Fisher-Yates 顺序消费 Math.random(可预测排列)', () => {
    // Math.random 恒为 0 → 每轮都与区间第 0 个下标交换：
    // [1,2,3,4] --swap(3,0)--> [4,2,3,1] --swap(2,0)--> [3,2,4,1] --swap(1,0)--> [2,3,4,1]
    vi.spyOn(Math, 'random').mockReturnValue(0)
    expect(shuffle([1, 2, 3, 4])).toEqual([2, 3, 4, 1])
  })
})

describe('pickArtistTracks', () => {
  it('hot 模式取池子前 10 首,保序', () => {
    const pool = Array.from({ length: 15 }, (_, i) => mkTrack(1, i))
    const picked = pickArtistTracks(pool, 'hot')
    expect(picked).toHaveLength(10)
    expect(picked).toEqual(pool.slice(0, 10))
  })

  it('hot 模式曲库不足 10 首时有多少取多少', () => {
    const pool = Array.from({ length: 3 }, (_, i) => mkTrack(1, i))
    expect(pickArtistTracks(pool, 'hot')).toHaveLength(3)
  })

  it('random 模式从全池抽 10 首,元素均来自原池', () => {
    const pool = Array.from({ length: 20 }, (_, i) => mkTrack(1, i))
    const picked = pickArtistTracks(pool, 'random')
    expect(picked).toHaveLength(10)
    const poolIds = new Set(pool.map((t) => t.id))
    for (const t of picked) expect(poolIds.has(t.id)).toBe(true)
  })

  it('random 模式曲库不足 10 首时返回全池洗牌结果', () => {
    const pool = Array.from({ length: 4 }, (_, i) => mkTrack(1, i))
    expect(pickArtistTracks(pool, 'random')).toHaveLength(4)
  })
})

describe('computeDefaultSongCount', () => {
  it('按目标总数(60)摊,人少则每人首数多', () => {
    expect(computeDefaultSongCount(1)).toBe(15) // 60 夹到上限 15
    expect(computeDefaultSongCount(6)).toBe(10) // 60/6=10
    expect(computeDefaultSongCount(12)).toBe(5) // 60/12=5
  })

  it('人数很多时夹在下限 5', () => {
    expect(computeDefaultSongCount(20)).toBe(5)
  })

  it('0 或负数按默认 10 处理', () => {
    expect(computeDefaultSongCount(0)).toBe(10)
    expect(computeDefaultSongCount(-1)).toBe(10)
  })
})

describe('buildRoamTracks', () => {
  it('汇总多位歌手已选曲目,总数不丢失', () => {
    const picksA = Array.from({ length: 10 }, (_, i) => mkTrack(1, i))
    const picksB = Array.from({ length: 3 }, (_, i) => mkTrack(2, i))
    const all = buildRoamTracks([picksA, picksB])
    expect(all).toHaveLength(13)
    const ids = new Set(all.map((t) => t.id))
    expect(ids.size).toBe(13)
  })

  it('空输入返回空数组', () => {
    expect(buildRoamTracks([])).toEqual([])
  })
})
