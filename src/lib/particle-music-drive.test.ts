import { describe, expect, it } from 'vitest'
import { createParticleMusicDrive } from './particle-music-drive'

function passage(fps: number, interval: number, energy = 0.3) {
  const drive = createParticleMusicDrive()
  let value = 0
  for (let frame = 0; frame < fps * 10; frame++) {
    value = drive.update(energy, frame / fps, frame > 0 && frame % Math.round(fps * interval) === 0)
  }
  return value
}

describe('粒光段落推进感', () => {
  it.each([30, 60, 120])('%s Hz 下密集节奏明显高于稀疏节奏，而不要求单拍升级为重鼓', fps => {
    expect(passage(fps, 0.2)).toBeGreaterThan(passage(fps, 1) + 0.45)
    expect(passage(fps, 0.5)).toBeGreaterThan(passage(fps, 1))
  })

  it('相同节奏下，持续编曲能量抬升也能推动段落，而非只看鼓点', () => {
    const steady = createParticleMusicDrive()
    const rising = createParticleMusicDrive()
    let quiet = 0
    let lifted = 0
    for (let frame = 0; frame < 600; frame++) {
      const onset = frame > 0 && frame % 60 === 0
      quiet = steady.update(0.2, frame / 60, onset)
      lifted = rising.update(frame > 300 ? 0.5 : 0.2, frame / 60, onset)
    }
    expect(lifted).toBeGreaterThan(quiet + 0.3)
  })

  it('稳定响度不自行制造高潮；音乐停止后平滑收住', () => {
    const drive = createParticleMusicDrive()
    for (let frame = 0; frame < 180; frame++) expect(drive.update(0.8, frame / 60, false)).toBe(0)
    let value = 0
    for (let frame = 180; frame < 600; frame++) value = drive.update(0.8, frame / 60, frame % 12 === 0)
    expect(value).toBeGreaterThan(0.6)
    const before = value
    value = drive.update(0, 10, false)
    expect(value).toBeGreaterThan(before - 0.02)
    for (let frame = 601; frame < 1200; frame++) value = drive.update(0, frame / 60, false)
    expect(value).toBeLessThan(0.02)
  })

  it('起播频谱逐渐建立时先适应基准，不把开场误当成高潮', () => {
    const drive = createParticleMusicDrive()
    let value = 0
    for (let frame = 0; frame < 240; frame++) {
      value = drive.update(Math.min(0.5, frame / 60), frame / 60, false)
    }
    expect(value).toBeLessThan(0.02)
  })

  it('面板先空置或长暂停后再播放，不把频谱恢复误当高潮', () => {
    const drive = createParticleMusicDrive()
    let value = 0
    for (let frame = 0; frame < 360; frame++) {
      value = drive.update(frame < 180 ? 0 : Math.min(0.5, (frame - 180) / 60), frame / 60, false)
    }
    expect(value).toBeLessThan(0.02)
    for (let frame = 360; frame < 720; frame++) drive.update(0.5, frame / 60, frame % 12 === 0)
    for (let frame = 720; frame < 1080; frame++) drive.update(0, frame / 60, false)
    const beforeResume = drive.update(0, 18, false)
    const resumed = drive.update(0.5, 18 + 1 / 60, false)
    expect(resumed).toBeLessThanOrEqual(beforeResume)
  })

  it('时钟回退或长停帧后重新建立基准，不保留上一段高潮', () => {
    const drive = createParticleMusicDrive()
    for (let frame = 0; frame < 600; frame++) drive.update(0.5, frame / 60, frame % 12 === 0)
    expect(drive.update(0.5, 0, false)).toBe(0)
    expect(drive.update(0.9, 10, true)).toBe(0)
  })

  it('不同帧率下段落响应接近且始终有界', () => {
    const values = [30, 60, 120].map(fps => passage(fps, 0.2))
    expect(Math.max(...values) - Math.min(...values)).toBeLessThan(0.04)
    expect(values.every(value => value >= 0 && value <= 1)).toBe(true)
  })
})
