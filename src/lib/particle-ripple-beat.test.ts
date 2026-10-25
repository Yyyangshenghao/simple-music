import { describe, expect, it } from 'vitest'
import { createParticleRippleBeatDetector } from './particle-ripple-beat'

function prime(detector: ReturnType<typeof createParticleRippleBeatDetector>, bass = 1, sensitivity = 0.5) {
  for (let frame = 0; frame <= 30; frame++) detector.update(bass, frame / 30, sensitivity)
}

describe('粒光波纹鼓点', () => {
  it('起播阶跃、持续低频、静音和轻微噪声不产生假鼓点', () => {
    for (const bass of [0, 0.2, 1.4]) {
      const detector = createParticleRippleBeatDetector()
      for (let frame = 0; frame < 180; frame++) {
        expect(detector.update(bass + (frame % 2 ? 0.005 : 0), frame / 60, 0.5)).toBeNull()
      }
    }
  })

  it.each([30, 60, 120])('%s Hz 下持续贝斯上的规律鼓点每拍触发一次', fps => {
    const detector = createParticleRippleBeatDetector()
    for (let frame = 0; frame < fps; frame++) detector.update(1, frame / fps, 0.5)
    let hits = 0
    for (let frame = 0; frame < fps * 3; frame++) {
      const bass = frame % (fps / 2) < fps * 0.08 ? 1.3 : 1
      if (detector.update(bass, 1 + frame / fps, 0.5)) hits++
    }
    expect(hits).toBe(6)
  })

  it('弱鼓点可以随灵敏度提高而触发，而非只看绝对响度', () => {
    const low = createParticleRippleBeatDetector()
    const high = createParticleRippleBeatDetector()
    prime(low, 0.3, 0)
    prime(high, 0.3, 1)
    expect(low.update(0.33, 1.04, 0)).toBeNull()
    expect(high.update(0.33, 1.04, 1)).toMatchObject({ kind: 'soft' })
  })

  it('一拍内的多次抖动不会连发波纹，之后仍可重新触发', () => {
    const detector = createParticleRippleBeatDetector()
    prime(detector)
    expect(detector.update(1.5, 1.04, 0.5)).toMatchObject({ kind: 'accent' })
    expect(detector.update(1, 1.08, 0.5)).toBeNull()
    expect(detector.update(1.6, 1.12, 0.5)).toBeNull()
    for (let frame = 0; frame < 10; frame++) detector.update(1, 1.15 + frame / 30, 0.5)
    expect(detector.update(1.5, 1.6, 0.5)).toMatchObject({ kind: 'accent' })
  })

  it('轻低频触发小波纹，强低频仍触发重鼓', () => {
    const soft = createParticleRippleBeatDetector()
    const accent = createParticleRippleBeatDetector()
    prime(soft)
    prime(accent)
    const hit = soft.update(1.07, 1.04, 0.5)
    expect(hit).toMatchObject({ kind: 'soft' })
    expect(hit!.strength).toBeLessThan(0.45)
    expect(accent.update(1.3, 1.04, 0.5)).toMatchObject({ kind: 'accent' })
  })

  it('中高频小军鼓可独立触发，轻鼓不阻塞紧随其后的重鼓', () => {
    const detector = createParticleRippleBeatDetector()
    for (let frame = 0; frame <= 30; frame++) detector.update(1, frame / 30, 0.5, 0.2)
    expect(detector.update(1, 1.04, 0.5, 0.26)).toMatchObject({ kind: 'soft' })
    expect(detector.update(1.3, 1.08, 0.5, 0.2)).toMatchObject({ kind: 'accent' })
  })

  it('稳定中高频和轻微底噪不触发，密集轻鼓限制连发频率', () => {
    const detector = createParticleRippleBeatDetector()
    for (let frame = 0; frame <= 60; frame++) {
      expect(detector.update(0.3, frame / 60, 0.5, 0.4 + (frame % 2) * 0.003)).toBeNull()
    }
    expect(detector.update(0.3, 1.04, 0.5, 0.5)).toMatchObject({ kind: 'soft' })
    expect(detector.update(0.3, 1.08, 0.5, 0.4)).toBeNull()
    expect(detector.update(0.3, 1.12, 0.5, 0.52)).toBeNull()
    for (let frame = 0; frame < 8; frame++) detector.update(0.3, 1.14 + frame / 30, 0.5, 0.4)
    expect(detector.update(0.3, 1.44, 0.5, 0.52)).toMatchObject({ kind: 'soft' })
  })

  it('波纹强度随实际瞬态连续变化，不把过阈值的小鼓点直接放大为重浪', () => {
    const strengths = [1.15, 1.3, 1.8].map(bass => {
      const detector = createParticleRippleBeatDetector()
      prime(detector)
      return detector.update(bass, 1.04, 0.5)!.strength
    })
    expect(strengths[0]).toBeLessThan(0.2)
    expect(strengths[1]).toBeGreaterThan(strengths[0])
    expect(strengths[2]).toBeGreaterThan(strengths[1])
    expect(strengths[2]).toBeLessThanOrEqual(0.85)
  })

  it.each([30, 60, 120])('%s Hz 下重复低频以小荡漾为主，明显超出近期节奏的冲击才是重鼓', fps => {
    const detector = createParticleRippleBeatDetector()
    prime(detector)
    const hits: Array<{ kind: string; strength: number }> = []
    for (let beat = 0; beat < 12; beat++) {
      for (let frame = 0; frame < fps / 2; frame++) {
        const value = frame < fps * 0.08 ? (beat === 11 ? 1.9 : 1.3) : 1
        const hit = detector.update(value, 1.04 + beat * 0.5 + frame / fps, 0.5)
        if (hit) hits.push(hit)
      }
    }
    expect(hits).toHaveLength(12)
    expect(hits.slice(0, 11).filter(hit => hit.kind === 'accent').length).toBeLessThanOrEqual(2)
    expect(hits.at(-1)!.kind).toBe('accent')
    expect(hits.at(-1)!.strength).toBeGreaterThan(hits[9].strength * 2)
  })

  it('连续较响但相近的鼓点也会适应，复位后丢弃上一段的节奏基准', () => {
    const detector = createParticleRippleBeatDetector()
    prime(detector)
    const kinds: string[] = []
    for (let beat = 0; beat < 12; beat++) {
      for (let frame = 0; frame < 15; frame++) {
        const hit = detector.update(frame < 2 ? 1.8 : 1, 1.04 + beat * 0.5 + frame / 30, 0.5)
        if (hit) kinds.push(hit.kind)
      }
    }
    expect(kinds).toHaveLength(12)
    expect(kinds.slice(-8).every(kind => kind === 'soft')).toBe(true)
    detector.reset()
    prime(detector)
    expect(detector.update(1.8, 1.04, 0.5)).toMatchObject({ kind: 'accent' })
  })

  it.each([30, 60, 120])('%s Hz 下密集轻鼓不会被旧的 160ms 冷却吞掉', fps => {
    const detector = createParticleRippleBeatDetector()
    const interval = Math.round(fps / 8)
    for (let frame = 0; frame < fps; frame++) detector.update(1, frame / fps, 0.5, 0.2)
    let hits = 0
    for (let frame = 0; frame < interval * 24; frame++) {
      const hit = detector.update(1, 1 + frame / fps, 0.5, frame % interval === 0 ? 0.32 : 0.2)
      if (hit) hits++
    }
    expect(hits).toBe(24)
  })

  it.each([30, 60, 120])('%s Hz 下平滑渐强不伪造成一串密集鼓点', fps => {
    const detector = createParticleRippleBeatDetector()
    let hits = 0
    for (let frame = 0; frame < fps * 3; frame++) {
      const bass = 0.2 + Math.max(0, frame / fps - 1) * 0.4
      if (detector.update(bass, frame / fps, 0.5, bass * 0.5)) hits++
    }
    expect(hits).toBeLessThanOrEqual(1)
  })

  it.each([30, 60, 120])('%s Hz 重复消费宿主 30Hz 频谱时，渐强也不会伪造密鼓', fps => {
    const detector = createParticleRippleBeatDetector()
    let hits = 0
    for (let frame = 0; frame < fps * 3; frame++) {
      const time = frame / fps
      const sampled = Math.floor(time * 30) / 30
      const bass = 0.2 + Math.max(0, sampled - 1) * 0.4
      if (detector.update(bass, time, 0.5, bass * 0.5)) hits++
    }
    expect(hits).toBeLessThanOrEqual(1)
  })

  it.each([30, 60, 120])('%s Hz 消费宿主 30Hz 的密集鼓点仍逐拍触发', fps => {
    const detector = createParticleRippleBeatDetector()
    for (let frame = 0; frame < fps; frame++) detector.update(1, frame / fps, 0.5, 0.2)
    let hits = 0
    for (let frame = 0; frame < fps * 3.2; frame++) {
      const sourceFrame = Math.floor((frame + 0.1) / fps * 30)
      const hit = detector.update(1, 1 + frame / fps, 0.5, sourceFrame % 4 === 0 ? 0.32 : 0.2)
      if (hit) hits++
    }
    expect(hits).toBe(24)
  })

  it('空频谱复位、时钟回退或长时间停帧后重新适应，不把恢复当鼓点', () => {
    const detector = createParticleRippleBeatDetector()
    prime(detector)
    detector.reset()
    expect(detector.update(1.8, 2, 0.5)).toBeNull()
    expect(detector.update(1.8, 1, 0.5)).toBeNull()
    expect(detector.update(1.8, 10, 0.5)).toBeNull()
  })
})
