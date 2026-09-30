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
    motionIntensity: 1, rippleSensitivity: 0.5, rippleCount: 6, rippleDuration: 0.55
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
  usePlayerStore: { getState: () => ({ _engine: () => ({ getFrequencyData: harness.readFrequency }) }) }
}))
vi.mock('../../lib/api', () => ({ api: {} }))
vi.mock('../../lib/dot-texture', () => ({ getDotSpriteTexture: () => null }))

import { CoverParticleCloud } from './CoverParticleCloud'

describe('CoverParticleCloud 动画时钟', () => {
  beforeEach(() => {
    vi.spyOn(performance, 'now').mockReturnValue(0)
    harness.mode = 'balanced'
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

  it('鼓点产生后，未重新采样的相邻帧仍衰减节拍并推进涟漪', () => {
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
    expect(uniforms.uBeat.value).toBeCloseTo(beat - 3.5 / 60, 8)
    expect(rippleData[2]).toBeCloseTo(age + 1 / 60, 6)
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
})
