import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useVisualStore } from '../../stores/visual'
import { usePlayerStore } from '../../stores/player'
import { api } from '../../lib/api'
import { generateShape } from './presets/shapes'
import { bassEnergyFrom } from '../../lib/audio-energy'
import type { PerformanceMode } from '../../types/domain'

const COUNT_BY_MODE: Record<PerformanceMode, number> = {
  eco: 4000,
  balanced: 8000,
  high: 12000,
  ultra: 16000
}

function bassEnergy(): number {
  const engine = usePlayerStore.getState()._engine()
  return bassEnergyFrom(engine.getFrequencyData())
}

interface CoverParticleCloudProps {
  coverUrl?: string
}

interface SampledParticles {
  positions: Float32Array
  colors: Float32Array
  count: number
}

function buildFallback(count: number): SampledParticles {
  const positions = generateShape('sphere', count)
  const colors = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    colors[i * 3] = 0.85
    colors[i * 3 + 1] = 0.85
    colors[i * 3 + 2] = 0.9
  }
  return { positions, colors, count }
}

export function CoverParticleCloud({ coverUrl }: CoverParticleCloudProps) {
  const pointsRef = useRef<THREE.Points>(null)
  const performanceMode = useVisualStore((s) => s.performanceMode)
  const maxCount = COUNT_BY_MODE[performanceMode]

  // 存采样结果
  const sampledRef = useRef<SampledParticles | null>(null)
  // 触发重建 geometry 的标志
  const dirtyRef = useRef(true)

  const proxyUrl = coverUrl ? api.url('/proxy/cover', { url: coverUrl }) : undefined

  // 采样封面图片
  useEffect(() => {
    if (!proxyUrl) {
      sampledRef.current = buildFallback(maxCount)
      dirtyRef.current = true
      return
    }

    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.src = proxyUrl

    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = 96
      canvas.height = 96
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        sampledRef.current = buildFallback(maxCount)
        dirtyRef.current = true
        return
      }
      ctx.drawImage(img, 0, 0, 96, 96)
      const imageData = ctx.getImageData(0, 0, 96, 96).data

      // 收集有效像素（过滤暗色）
      const validPixels: Array<{ x: number; y: number; r: number; g: number; b: number }> = []
      for (let py = 0; py < 96; py++) {
        for (let px = 0; px < 96; px++) {
          const idx = (py * 96 + px) * 4
          const r = imageData[idx]
          const g = imageData[idx + 1]
          const b = imageData[idx + 2]
          const brightness = (r + g + b) / 3
          if (brightness >= 20) {
            validPixels.push({ x: px, y: py, r, g, b })
          }
        }
      }

      if (validPixels.length === 0) {
        sampledRef.current = buildFallback(maxCount)
        dirtyRef.current = true
        return
      }

      // 按 maxCount 决定实际粒子数，超出时重复采样
      const count = maxCount
      const positions = new Float32Array(count * 3)
      const colors = new Float32Array(count * 3)

      for (let i = 0; i < count; i++) {
        const pixel = validPixels[i % validPixels.length]
        // 映射 [0,96) -> [-4,4]
        const wx = (pixel.x / 95) * 8 - 4
        const wy = -((pixel.y / 95) * 8 - 4) // 图像 y 轴翻转
        const wz = (Math.random() - 0.5) * 2.4  // ±1.2 深度扰动

        positions[i * 3] = wx
        positions[i * 3 + 1] = wy
        positions[i * 3 + 2] = wz

        colors[i * 3] = pixel.r / 255
        colors[i * 3 + 1] = pixel.g / 255
        colors[i * 3 + 2] = pixel.b / 255
      }

      sampledRef.current = { positions, colors, count }
      dirtyRef.current = true
    }

    img.onerror = () => {
      sampledRef.current = buildFallback(maxCount)
      dirtyRef.current = true
    }

    // 切歌/卸载时取消在途加载:防止旧封面回调晚到覆盖新采样,也断开对 img 的引用
    return () => {
      img.onload = null
      img.onerror = null
      img.src = ''
    }
  }, [proxyUrl, maxCount])

  // 初始 fallback（组件挂载时）
  useEffect(() => {
    if (!sampledRef.current) {
      sampledRef.current = buildFallback(maxCount)
      dirtyRef.current = true
    }
  }, [maxCount])

  // 构建 geometry（属性只分配一次，useFrame 里原地写入，避免每次切歌新建 GPU buffer）
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const fallback = buildFallback(maxCount)
    g.setAttribute('position', new THREE.BufferAttribute(fallback.positions, 3))
    g.setAttribute('color', new THREE.BufferAttribute(fallback.colors, 3))
    return g
  }, [maxCount])

  // 性能档切换/卸载时释放旧 geometry 的 GPU buffer
  useEffect(() => () => geometry.dispose(), [geometry])

  useFrame((_, delta) => {
    // 如果采样结果更新了，原地覆写属性数据（粒子数恒为 maxCount，长度总是匹配）
    if (dirtyRef.current && sampledRef.current) {
      dirtyRef.current = false
      const { positions, colors } = sampledRef.current
      const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute
      const colAttr = geometry.getAttribute('color') as THREE.BufferAttribute
      if (posAttr.array.length === positions.length && colAttr.array.length === colors.length) {
        ;(posAttr.array as Float32Array).set(positions)
        ;(colAttr.array as Float32Array).set(colors)
        posAttr.needsUpdate = true
        colAttr.needsUpdate = true
      } else {
        // 采样结果与 geometry 粒子数短暂失配（性能档切换瞬间）:留 dirty 待新采样落地
        dirtyRef.current = true
      }
    }

    const energy = bassEnergy()
    const pts = pointsRef.current
    if (pts) {
      pts.rotation.y += delta * (0.15 + energy * 0.4)
      pts.rotation.x += delta * 0.03
      const scale = 1 + energy * 0.25
      pts.scale.setScalar(scale)
    }
  })

  return (
    <points ref={pointsRef} geometry={geometry}>
      <pointsMaterial
        vertexColors
        size={0.05}
        sizeAttenuation
        transparent
        opacity={0.88}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  )
}
