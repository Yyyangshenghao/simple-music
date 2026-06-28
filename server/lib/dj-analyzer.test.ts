import { describe, it, expect } from 'vitest'
import { buildBeatMapFromLowEnergy } from './dj-analyzer'

/**
 * 仅测试纯函数 buildBeatMapFromLowEnergy：不触网、不解码。
 * 构造一段含明显周期性低频能量峰值（约 120 BPM）的能量序列，
 * 断言返回的节拍图结构正确。
 */
function buildPeriodicEnergy(nFrames: number, periodFrames: number): { low: number[]; hit: number[] } {
  const low = new Array<number>(nFrames)
  const hit = new Array<number>(nFrames)
  for (let i = 0; i < nFrames; i++) {
    const phase = i % periodFrames
    let l = 0.02
    let h = 0.01
    if (phase === 0) {
      l = 0.6
      h = 0.7
    } else if (phase === 1) {
      l = 0.4
      h = 0.45
    } else if (phase === 2) {
      l = 0.15
      h = 0.2
    }
    low[i] = l
    hit[i] = h
  }
  return { low, hit }
}

describe('buildBeatMapFromLowEnergy', () => {
  it('returns an empty map when there are too few frames', () => {
    const map = buildBeatMapFromLowEnergy([0.1, 0.2, 0.1], [0.1, 0.2, 0.1], 0.01, 0.03)
    expect(map.beats).toEqual([])
    expect(map.kicks).toEqual([])
    expect(map.pulseBeats).toEqual([])
    expect(map.cameraBeats).toEqual([])
    expect(map.visualBeatCount).toBe(0)
    expect(map.tempoSource).toBe('podcast-dj-server-empty')
    expect(typeof map.analyzedAt).toBe('number')
  })

  it('detects a periodic beat grid and produces a well-formed map', () => {
    const hopSec = 0.01
    const periodFrames = 50 // 0.5s -> 120 BPM
    const nFrames = 4000 // 40s
    const { low, hit } = buildPeriodicEnergy(nFrames, periodFrames)
    const durationSec = nFrames * hopSec
    const map = buildBeatMapFromLowEnergy(low, hit, hopSec, durationSec)

    // 结构字段存在
    expect(Array.isArray(map.beats)).toBe(true)
    expect(Array.isArray(map.kicks)).toBe(true)
    expect(Array.isArray(map.pulseBeats)).toBe(true)
    expect(Array.isArray(map.cameraBeats)).toBe(true)
    expect(typeof map.gridStep).toBe('number')
    expect(map.tempoSource).toBe('podcast-dj-server-low-offline')
    expect(map.duration).toBeCloseTo(durationSec, 5)
    expect(typeof map.analyzedAt).toBe('number')

    // 确实检测到节拍
    expect(map.beats.length).toBeGreaterThan(0)
    expect(map.kicks.length).toBe(map.beats.length)
    expect(map.visualBeatCount).toBe(map.cameraBeats.length)
    expect(map.visualBeatCount).toBeGreaterThan(0)

    // gridStep 在合法区间，且 BPM 合理（输入约 120 BPM）
    const gridStep = map.gridStep as number
    expect(gridStep).toBeGreaterThanOrEqual(0.32)
    expect(gridStep).toBeLessThanOrEqual(0.86)
    const bpm = 60 / gridStep
    expect(bpm).toBeGreaterThan(60)
    expect(bpm).toBeLessThan(200)

    // beats 时间单调递增
    for (let i = 1; i < map.beats.length; i++) {
      expect(map.beats[i].time).toBeGreaterThan(map.beats[i - 1].time)
    }

    // 每个 beat 字段结构合理
    for (const b of map.beats) {
      expect(typeof b.time).toBe('number')
      expect(b.strength).toBeGreaterThanOrEqual(0)
      expect(b.impact).toBeGreaterThanOrEqual(0)
      expect(typeof b.combo).toBe('string')
      expect(b.dj).toBe(true)
    }
  })
})
