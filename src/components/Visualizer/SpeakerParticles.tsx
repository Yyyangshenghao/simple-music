import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useVisualStore } from '../../stores/visual'
import { usePlayerStore } from '../../stores/player'
import { bassEnergyFrom } from '../../lib/audio-energy'
import type { PerformanceMode } from '../../types/domain'

/**
 * 音箱沙粒效果 —— 移植自 audio-visualizer 开源项目的 ParticleEffect。
 * 粒子分布在圆形平面上，音频低音"踢飞"粒子跳跃，径向推开，
 * 飞到边界后中心重生，像扬声器振膜上的沙粒被声波震得跳动。
 */

const COUNT_BY_MODE: Record<PerformanceMode, number> = {
  eco: 30000,
  balanced: 60000,
  high: 100000,
  ultra: 160000
}

// 存储每粒子的 Y 速度
// 因为 THREE.Points 不支持 custom attributes 给 PointsMaterial，我们用独立数组

function bassEnergy(): number {
  const engine = usePlayerStore.getState()._engine()
  return bassEnergyFrom(engine.getFrequencyData())
}

/** 从频谱取平均能量（全频段），与 audio-visualizer 的 getAverageFrequency 语义一致 */
function avgFrequency(): number {
  const engine = usePlayerStore.getState()._engine()
  const data = engine.getFrequencyData()
  if (!data.length) return 0
  let sum = 0
  for (let i = 0; i < data.length; i++) sum += data[i]
  return sum / data.length
}

export function SpeakerParticles() {
  const pointsRef = useRef<THREE.Points>(null)
  const matRef = useRef<THREE.PointsMaterial>(null)
  const performanceMode = useVisualStore((s) => s.performanceMode)
  const count = COUNT_BY_MODE[performanceMode]

  const radius = 5
  const maxKickForce = 12
  const gravity = -19.8
  const expansionSpeed = 2.5
  const resetRadius = radius * 1.5

  // 粒子数据：positions + 独立 velocities 数组
  const { positions, velocities } = useMemo(() => {
    const pos = new Float32Array(count * 3)
    const vel = new Float32Array(count)
    const initialSpawnRadius = 1.0

    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2
      const r = initialSpawnRadius * Math.sqrt(Math.random())
      pos[i * 3] = Math.cos(angle) * r
      pos[i * 3 + 1] = 0
      pos[i * 3 + 2] = Math.sin(angle) * r
      vel[i] = 0
    }
    return { positions: pos, velocities: vel }
  }, [count])

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    return g
  }, [positions])

  useFrame((_, delta) => {
    const freq = avgFrequency()
    // 归一化频率影响（0~1），与原始项目阈值对齐
    const freqInfluence = Math.min(Math.max(freq / 180, 0), 1)
    const currentKickStrength = maxKickForce * freqInfluence
    const kickThreshold = 0.01

    const posAttr = geometry.attributes.position as THREE.BufferAttribute
    const posArr = posAttr.array as Float32Array
    const resetRadiusSq = resetRadius * resetRadius
    const centerSpawnRadius = 0.08
    const centerSpawnRadiusSq = centerSpawnRadius * centerSpawnRadius

    for (let i = 0; i < count; i++) {
      const xIdx = i * 3
      const yIdx = xIdx + 1
      const zIdx = xIdx + 2

      const x = posArr[xIdx]
      const z = posArr[zIdx]
      const distSq = x * x + z * z

      // --- Y 轴：重力 + 低音踢飞 ---
      velocities[i] += gravity * delta
      posArr[yIdx] += velocities[i] * delta

      if (posArr[yIdx] <= 0) {
        posArr[yIdx] = 0
        if (freqInfluence > kickThreshold && distSq > centerSpawnRadiusSq) {
          // 低音命中，踢飞粒子（带随机性）
          velocities[i] = currentKickStrength * (0.5 + Math.random() * 0.5)
        } else {
          velocities[i] = 0
        }
      }

      // --- XZ 平面：频率驱动径向扩展 ---
      if (distSq > resetRadiusSq || Math.random() < 0.0005) {
        // 飞出边界或随机重生 → 回到中心
        const angle = Math.random() * Math.PI * 2
        const r = centerSpawnRadius * Math.sqrt(Math.random())
        posArr[xIdx] = Math.cos(angle) * r
        posArr[zIdx] = Math.sin(angle) * r
        posArr[yIdx] = 0
        velocities[i] = 0
      } else if (distSq > 0.001 && freqInfluence > kickThreshold) {
        const dist = Math.sqrt(distSq)
        const nx = x / dist
        const nz = z / dist
        const currentExpansionSpeed = expansionSpeed * freqInfluence
        posArr[xIdx] += nx * currentExpansionSpeed * delta
        posArr[zIdx] += nz * currentExpansionSpeed * delta
      }
    }

    posAttr.needsUpdate = true

    // 旋转整个粒子盘，增加动态感
    if (pointsRef.current) {
      pointsRef.current.rotation.y += delta * 0.15
      pointsRef.current.rotation.x = -0.35 // 微微倾斜，露出深度
    }

    // 动态颜色随频率变化
    if (matRef.current) {
      const hue = 0.55 + freqInfluence * 0.15
      matRef.current.color.setHSL(hue % 1, 0.7, 0.45 + freqInfluence * 0.35)
    }
  })

  return (
    <points ref={pointsRef} geometry={geometry}>
      <pointsMaterial
        ref={matRef}
        color="#7ec8f8"
        size={0.025}
        sizeAttenuation
        transparent
        opacity={0.85}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  )
}