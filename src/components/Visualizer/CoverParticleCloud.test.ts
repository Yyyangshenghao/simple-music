import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'
import * as THREE from 'three'

const harness = vi.hoisted(() => ({
  frame: null as null | ((state: unknown, delta: number) => void),
  mode: 'balanced',
  frequency: new Uint8Array(1024).fill(128),
  readFrequency: vi.fn(),
  cleanups: [] as Array<() => void>,
  params: {
    particleCount: 1, particleSize: 1, particleBrightness: 1, glowStrength: 1,
    motionIntensity: 1, rippleSensitivity: 0.5, rippleAmplitude: 0.5, rippleDuration: 0.55
  }
}))

vi.mock('react', () => ({
  useRef: (current: unknown) => ({ current }),
  useMemo: (factory: () => unknown) => factory(),
  useEffect: (effect: () => void | (() => void)) => {
    const cleanup = effect()
    if (cleanup) harness.cleanups.push(cleanup)
  }
}))
vi.mock('@react-three/fiber', () => ({
  useFrame: (callback: typeof harness.frame) => { harness.frame = callback },
  useThree: (selector: (state: unknown) => unknown) => selector({ viewport: { dpr: 1 }, camera: {} })
}))
vi.mock('../../stores/visual', () => ({
  useVisualStore: (selector: (state: unknown) => unknown) => selector({ performanceMode: harness.mode })
}))
vi.mock('../../stores/settings', () => ({
  useSettingsStore: Object.assign(
    (selector: (state: unknown) => unknown) => selector({ lyrics3d: harness.params }),
    { getState: () => ({ lyrics3d: harness.params }) }
  )
}))
vi.mock('../../stores/player', () => ({
  usePlayerStore: { getState: () => ({ _frequencyData: harness.readFrequency }) }
}))
vi.mock('../../lib/api', () => ({ api: {} }))
vi.mock('../../lib/dot-texture', () => ({ getDotSpriteTexture: () => null }))

import { CoverParticleCloud } from './CoverParticleCloud'

describe('CoverParticleCloud 动画时钟', () => {
  beforeEach(() => {
    vi.spyOn(performance, 'now').mockReturnValue(0)
    harness.mode = 'balanced'
    harness.params.rippleAmplitude = 0.5
    harness.params.rippleSensitivity = 0.5
    harness.params.rippleDuration = 0.55
    harness.frequency.fill(128)
    harness.readFrequency.mockReset().mockImplementation(() => harness.frequency)
    vi.stubGlobal('document', {
      createElement: () => ({ getContext: () => ({ fillRect: () => {} }) })
    })
  })

  afterEach(() => {
    harness.cleanups.splice(0).forEach(cleanup => cleanup())
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  function mount() {
    const tree = CoverParticleCloud({})
    const points = tree.props.children[0] as ReactElement
    const material = points.props.children as ReactElement
    const uniforms = material.props.uniforms as Record<string, { value: number }>
    const camera = new THREE.PerspectiveCamera()
    let elapsed = 0
    const tick = (delta = 1 / 60) => {
      elapsed += delta
      vi.mocked(performance.now).mockReturnValue(elapsed * 1000)
      harness.frame!({ clock: { getElapsedTime: () => elapsed }, camera }, delta)
    }
    return { uniforms, tick, rippleData: material.props.uniforms.uRippleTex.value.image.data as Float32Array }
  }

  it.each(['eco', 'balanced'])('%s 档在未采样的帧仍推进音频动画，频谱保持 30Hz', mode => {
    harness.mode = mode
    const { uniforms, tick } = mount()
    const energies: number[] = []
    for (let frame = 0; frame < 60; frame++) {
      tick()
      energies.push(uniforms.uEnergy.value)
    }
    expect(harness.readFrequency.mock.calls.length).toBeGreaterThanOrEqual(29)
    expect(harness.readFrequency.mock.calls.length).toBeLessThanOrEqual(31)
    for (let i = 1; i < energies.length; i++) expect(energies[i]).toBeGreaterThan(energies[i - 1])
  })

  it('鼓点产生后，未重新采样的相邻帧仍柔和起波并推进涟漪', () => {
    const { uniforms, tick, rippleData } = mount()
    for (let i = 0; i < 60; i++) tick()
    harness.frequency.fill(0)
    tick()
    tick()
    harness.frequency.fill(128)
    tick()
    tick()
    expect(uniforms.uRippleCount.value).toBeGreaterThan(0)
    const beat = uniforms.uBeat.value
    const age = rippleData[2]
    const reads = harness.readFrequency.mock.calls.length
    tick()
    expect(harness.readFrequency).toHaveBeenCalledTimes(reads)
    expect(uniforms.uBeat.value).toBeGreaterThanOrEqual(beat)
    expect(uniforms.uBeat.value - beat).toBeLessThan(0.01)
    expect(rippleData[2]).toBeCloseTo(age + 1 / 60, 6)
  })

  it.each(['balanced', 'high'])('%s 持续低频上的每次鼓点都能重新触发，不要求低频先降到固定阈值以下', mode => {
    harness.mode = mode
    const { uniforms, tick, rippleData } = mount()
    for (let i = 0; i < 90; i++) tick()
    let hits = 0
    for (let beat = 0; beat < 6; beat++) {
      let triggered = false
      for (let frame = 0; frame < 30; frame++) {
        harness.frequency.fill(frame < 4 ? 160 : 128)
        tick()
        for (let i = 0; i < uniforms.uRippleCount.value; i++) {
          if (rippleData[i * 4 + 2] < 0.02) triggered = true
        }
      }
      if (triggered) hits++
    }
    expect(hits).toBe(6)
    expect(uniforms.uRippleCount.value).toBeGreaterThan(0)
  })

  it('低频鼓点不被全频平均能量的启动门槛挡住', () => {
    harness.frequency.fill(0)
    harness.frequency.fill(20, 0, 12)
    const { uniforms, tick } = mount()
    for (let i = 0; i < 90; i++) tick()
    harness.frequency.fill(45, 0, 12)
    for (let i = 0; i < 4; i++) tick()
    expect(uniforms.uRippleCount.value).toBeGreaterThan(0)
  })


  it('小军鼓只生成一道轻波纹并自然消退', () => {
    const { uniforms, tick, rippleData } = mount()
    for (let i = 0; i < 90; i++) tick()
    harness.frequency.fill(160, 12, 279)
    tick(); tick()
    expect(uniforms.uRippleCount.value).toBe(1)
    expect(rippleData[3]).toBeGreaterThan(0.025)
    expect(rippleData[3]).toBeLessThan(0.45)
    expect(uniforms.uBeat.value).toBeLessThan(0.45)
    for (let i = 0; i < 100; i++) tick()
    expect(uniforms.uRippleCount.value).toBe(0)
  })

  it('轻低频也只生成一道小波纹，关闭波纹后不再显示', () => {
    const { uniforms, tick, rippleData } = mount()
    for (let i = 0; i < 90; i++) tick()
    harness.frequency.fill(139, 0, 12)
    tick(); tick()
    expect(uniforms.uRippleCount.value).toBe(1)
    expect(rippleData[3]).toBeLessThan(0.45)
    harness.params.rippleAmplitude = 0
    tick()
    expect(uniforms.uRippleCount.value).toBe(0)
  })



  it('连续轻鼓随机分散落点，前一圈的位置、年龄与强度不被重置', () => {
    const { uniforms, tick, rippleData } = mount()
    for (let i = 0; i < 90; i++) tick()
    vi.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValueOnce(0.25)
      .mockReturnValueOnce(0.25).mockReturnValueOnce(0.81)
    harness.frequency.fill(160, 12, 279)
    tick(); tick()
    const strength = rippleData[3]
    const x = rippleData[0]
    const y = rippleData[1]
    const age = rippleData[2]
    harness.frequency.fill(128, 12, 279)
    for (let i = 0; i < 14; i++) tick()
    harness.frequency.fill(160, 12, 279)
    tick(); tick()
    expect(uniforms.uRippleCount.value).toBe(2)
    expect(rippleData[0]).toBe(x)
    expect(x).toBeCloseTo(0.72, 5)
    expect(rippleData[1]).toBe(y)
    expect(rippleData[2]).toBeCloseTo(age + 16 / 60, 6)
    expect(rippleData[3]).toBe(strength)
    expect(rippleData[4]).toBeCloseTo(0, 5)
    expect(rippleData[5]).toBeCloseTo(1.296, 5)
  })


  it('明显重鼓保留中心落点和更强波动', () => {
    const { uniforms, tick, rippleData } = mount()
    for (let i = 0; i < 90; i++) tick()
    harness.frequency.fill(230, 0, 12)
    tick(); tick()
    expect(uniforms.uRippleCount.value).toBe(1)
    expect(rippleData[0]).toBe(0)
    expect(rippleData[1]).toBe(0)
    expect(rippleData[3]).toBeGreaterThan(0.4)
    expect(rippleData[3]).toBeLessThanOrEqual(0.85)
  })

  it('密集轻鼓保留一个强拍空位，重鼓到来不需要截断旧波纹', () => {
    const { uniforms, tick, rippleData } = mount()
    for (let i = 0; i < 90; i++) tick()
    for (let tap = 0; tap < 5; tap++) {
      harness.frequency.fill(160, 12, 279)
      tick(); tick()
      if (tap < 4) {
        harness.frequency.fill(128, 12, 279)
        for (let i = 0; i < 10; i++) tick()
      }
    }
    expect(uniforms.uRippleCount.value).toBe(5)
    const strength = rippleData[3]
    const age = rippleData[2]
    harness.frequency.fill(230, 0, 12)
    tick(); tick()
    expect(uniforms.uRippleCount.value).toBe(6)
    expect(rippleData[3]).toBe(strength)
    expect(rippleData[2]).toBeGreaterThan(age)
    expect(rippleData[23]).toBeGreaterThan(0.4)
  })

  it('密集段落有更多新波纹和更高的整体推进感，停止后自然收住', () => {
    function play(interval: number, base: number) {
      harness.frequency.fill(base)
      const scene = mount()
      for (let i = 0; i < 90; i++) scene.tick()
      let births = 0
      for (let frame = 0; frame < 600; frame++) {
        harness.frequency.fill(base)
        if (frame % interval < 3) harness.frequency.fill(base + 32, 12, 279)
        scene.tick()
        for (let i = 0; i < scene.uniforms.uRippleCount.value; i++) {
          if (scene.rippleData[i * 4 + 2] === 0) births++
        }
        expect(scene.uniforms.uRippleCount.value).toBeLessThanOrEqual(6)
      }
      return { ...scene, births }
    }
    const sparse = play(60, 96)
    const sparseDrive = sparse.uniforms.uDrive.value
    const dense = play(10, 128)
    expect(dense.births).toBeGreaterThan(sparse.births * 2)
    expect(dense.uniforms.uDrive.value).toBeGreaterThan(sparseDrive + 0.4)
    const beforeStop = dense.uniforms.uDrive.value
    harness.frequency.fill(0)
    dense.tick()
    expect(dense.uniforms.uDrive.value).toBeGreaterThan(beforeStop - 0.02)
    for (let i = 0; i < 600; i++) dense.tick()
    expect(dense.uniforms.uDrive.value).toBeLessThan(0.02)
    expect(dense.uniforms.uRippleCount.value).toBe(0)
  })

  it('幅度只改变视觉增益，轻柔和强烈都保留相同鼓点与并发容量', () => {
    function play(amplitude: number) {
      harness.params.rippleAmplitude = amplitude
      harness.frequency.fill(128)
      const scene = mount()
      for (let i = 0; i < 90; i++) scene.tick()
      harness.frequency.fill(160, 12, 279)
      scene.tick(); scene.tick()
      return { count: scene.uniforms.uRippleCount.value, strength: scene.rippleData[3], gain: scene.uniforms.uRippleGain.value }
    }
    const soft = play(0.2)
    const strong = play(1)
    expect(soft.count).toBe(1)
    expect(strong.count).toBe(soft.count)
    expect(strong.strength).toBeCloseTo(soft.strength, 6)
    expect(soft.gain).toBeCloseTo(0.4, 4)
    expect(strong.gain).toBeCloseTo(2, 4)
  })

  it('调整幅度时平滑过渡，不重置已有波纹', () => {
    const { uniforms, tick, rippleData } = mount()
    for (let i = 0; i < 90; i++) tick()
    harness.frequency.fill(160, 12, 279)
    tick(); tick()
    const age = rippleData[2]
    harness.params.rippleAmplitude = 1
    tick()
    expect(uniforms.uRippleGain.value).toBeGreaterThan(1)
    expect(uniforms.uRippleGain.value).toBeLessThan(2)
    expect(rippleData[2]).toBeGreaterThan(age)
  })

  it('相同播放时长下，均衡与高性能档的能量包络一致', () => {
    const balanced = mount()
    for (let i = 0; i < 60; i++) balanced.tick()
    const balancedEnergy = balanced.uniforms.uEnergy.value
    harness.mode = 'high'
    const high = mount()
    for (let i = 0; i < 60; i++) high.tick()
    expect(high.uniforms.uEnergy.value).toBeCloseTo(balancedEnergy, 8)
  })

  it('关闭波纹清空已有涟漪，重新开启不会复活旧波纹', () => {
    const { uniforms, tick } = mount()
    for (let i = 0; i < 60; i++) tick()
    harness.frequency.fill(0)
    tick()
    tick()
    harness.frequency.fill(128)
    tick()
    tick()
    expect(uniforms.uRippleCount.value).toBeGreaterThan(0)
    harness.params.rippleAmplitude = 0
    tick()
    expect(uniforms.uRippleCount.value).toBe(0)
    harness.params.rippleAmplitude = 0.5
    tick()
    expect(uniforms.uRippleCount.value).toBe(0)
  })
})
