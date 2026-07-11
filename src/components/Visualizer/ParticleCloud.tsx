import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useVisualStore } from '../../stores/visual'
import { usePlayerStore } from '../../stores/player'
import { presetById } from './presets'
import { generateShape } from './presets/shapes'
import type { PerformanceMode } from '../../types/domain'

const COUNT_BY_MODE: Record<PerformanceMode, number> = {
  eco: 4000,
  balanced: 9000,
  high: 16000,
  ultra: 28000
}

function bassEnergy(): number {
  const engine = usePlayerStore.getState()._engine()
  const data = engine.getFrequencyData()
  if (!data.length) return 0
  const n = Math.min(16, data.length)
  let sum = 0
  for (let i = 0; i < n; i++) sum += data[i]
  return sum / n / 255
}

export function ParticleCloud() {
  const pointsRef = useRef<THREE.Points>(null)
  const matRef = useRef<THREE.PointsMaterial>(null)
  const preset = useVisualStore((s) => s.preset)
  const performanceMode = useVisualStore((s) => s.performanceMode)

  const count = COUNT_BY_MODE[performanceMode]
  const config = presetById(preset)

  const positions = useMemo(() => generateShape(config.shape, count), [config.shape, count])

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    return g
  }, [positions])

  // 换预设/性能档时 points 不卸载,r3f 不会替我们释放旧 geometry 的 GPU buffer
  useEffect(() => () => geometry.dispose(), [geometry])

  useFrame((_, delta) => {
    const fx = useVisualStore.getState().fx
    const energy = bassEnergy()
    const pts = pointsRef.current
    if (pts) {
      const speed = (Number(fx.speed) || 0.4) * 0.5
      pts.rotation.y += delta * (speed + energy * 0.6)
      pts.rotation.x += delta * speed * 0.15
      const twist = (Number(fx.twist) || 0) * 0.2
      pts.rotation.z += delta * twist
      const scale = 1 + energy * (0.25 + (Number(fx.intensity) || 0.5) * 0.6)
      pts.scale.setScalar(scale)
    }
    if (matRef.current) {
      const hue = (config.hue + (Number(fx.color) || 0) * 0.5) % 1
      const light = 0.45 + energy * 0.4
      matRef.current.color.setHSL(hue, 0.7, Math.min(0.9, light))
      matRef.current.size = 0.02 + (Number(fx.point) || 0.5) * 0.06 + energy * 0.04
    }
  })

  return (
    <points ref={pointsRef} geometry={geometry}>
      <pointsMaterial
        ref={matRef}
        size={0.04}
        sizeAttenuation
        transparent
        opacity={0.92}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  )
}
