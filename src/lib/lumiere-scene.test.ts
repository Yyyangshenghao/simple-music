import { describe, it, expect } from 'vitest'
import { activeShots, beamIntensity, beamPose, buildLumiereShots, glyphDrift, glyphRevealTimes, lumiereAmbient, lumiereLineArt, sparkleEnvelope, windowSlot, wrap01 } from './lumiere-scene'

const lines = ['一', '二', '三', '', '四', '五'].map((text, i) => ({ text, time: i * 3 }))

describe('绘光光位', () => {
  it('每两句换一个光位，相邻种类不同，结果固定', () => {
    const shots = buildLumiereShots(lines, 9)
    expect(shots.length).toBe(3)
    for (let i = 1; i < shots.length; i++) expect(shots[i].kind).not.toBe(shots[i - 1].kind)
    expect(buildLumiereShots(lines, 9)).toEqual(shots)
    expect(buildLumiereShots([], 1)).toHaveLength(1)
  })

  it('换光位时交叉渐变，渐变结束只剩新光位', () => {
    const shots = buildLumiereShots(lines, 9)
    const during = activeShots(shots, shots[1].start + 0.4)
    expect(during).toHaveLength(2)
    expect(during[0].weight + during[1].weight).toBeCloseTo(1)
    expect(activeShots(shots, shots[1].start + 2)).toHaveLength(1)
  })

  it('光束伸长后照到轴线上的点，背后与远离轴线的点不亮；静态模式不扫动', () => {
    const beam = { x: 0.5, y: 0, angle: Math.PI / 2, spread: 0.1, width: 0.03, sweep: 0.1, speed: 1, phase: 0, power: 1, warm: 0 }
    expect(beamPose(beam, 0, true).reach).toBe(0)
    expect(beamPose(beam, 5, false)).toEqual({ angle: Math.PI / 2, reach: 1 })
    const on = beamIntensity([beam], 5, false, 500, 400, 1000, 800)
    const off = beamIntensity([beam], 5, false, 50, 400, 1000, 800)
    const behind = beamIntensity([beam], 5, false, 500, -100, 1000, 800)
    expect(on).toBeGreaterThan(0.5)
    expect(off).toBe(0)
    expect(behind).toBe(0)
  })
})

describe('绘光歌词窗口', () => {
  it('当前句最大最亮；换句后从上一个槽位滑入；超出窗口不画', () => {
    expect(windowSlot(0, 5, true)).toMatchObject({ y: 0, scale: 1, alpha: 1, xk: 0, focus: 1 })
    expect(windowSlot(-1, 5, true)!.scale).toBeLessThan(1)
    const mid = windowSlot(0, 0.1, true)!
    expect(mid.y).toBeGreaterThan(0)
    expect(mid.scale).toBeLessThan(1)
    expect(windowSlot(0, 0.1, false)).toMatchObject({ y: 0, scale: 1, alpha: 1 })
    // 横向偏移与亮度系数也随过渡插值，不在换句那一帧跳变。
    expect(mid.xk).toBeGreaterThan(0)
    expect(mid.xk).toBeLessThan(1)
    expect(windowSlot(-1, 0.1, true)!.focus).toBeGreaterThan(0)
    expect(windowSlot(4, 1, true)).toBeNull()
  })

  it('逐字点亮时刻按词内均分，至少 80ms；空白不计', () => {
    const times = glyphRevealTimes([{ text: '今日 ', startMs: 0, endMs: 400 }, { text: '光', startMs: 500, endMs: 520 }])
    expect(times).toEqual([{ start: 0, end: 200 }, { start: 200, end: 400 }, { start: 500, end: 580 }])
  })

  it('闪点先升后衰减；崩解随进度越飘越远，未来行散开后逐渐聚拢', () => {
    expect(sparkleEnvelope(-1)).toBe(0)
    expect(sparkleEnvelope(0.03)).toBeCloseTo(1)
    expect(sparkleEnvelope(1)).toBeLessThan(0.05)
    const near = glyphDrift(1, 2, 'past', 0.2, 1)
    const far = glyphDrift(1, 2, 'past', 1, 1)
    expect(Math.hypot(far.dx, far.dy)).toBeGreaterThan(Math.hypot(near.dx, near.dy))
    expect(far.dy).toBeLessThan(0)
    expect(glyphDrift(1, 2, 'future', 0, 1)).toMatchObject({ rotate: 0, fade: 1 })
    expect(glyphDrift(1, 2, 'past', 1, 0).fade).toBe(1)
  })
})

describe('绘光背景元素', () => {
  it('星点、浮尘、散景与线稿数量合理且固定；线稿避开中部歌词带', () => {
    const ambient = lumiereAmbient(3)
    expect(ambient.stars.length).toBeGreaterThan(20)
    expect(lumiereAmbient(3)).toEqual(ambient)
    const art = lumiereLineArt(buildLumiereShots(lines, 2)[0])
    expect(art.length).toBeGreaterThanOrEqual(3)
    expect(art.every(item => item.y < 0.3 || item.y > 0.66)).toBe(true)
    expect(wrap01(1.25)).toBeCloseTo(0.25)
    expect(wrap01(-0.25)).toBeCloseTo(0.75)
  })
})
