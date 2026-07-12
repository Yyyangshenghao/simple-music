import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useVisualStore } from '../../stores/visual'
import { usePlayerStore } from '../../stores/player'
import { bassEnergyFrom, spectrumSlice } from '../../lib/audio-energy'
import type { PerformanceMode } from '../../types/domain'

const VERTICES_BY_MODE: Record<PerformanceMode, number> = {
  eco: 128,
  balanced: 192,
  high: 256,
  ultra: 320
}

export function Waveform3D() {
  const ringLowRef = useRef<THREE.LineLoop>(null)
  const ringHighRef = useRef<THREE.LineLoop>(null)
  const lowMatRef = useRef<THREE.LineBasicMaterial>(null)
  const highMatRef = useRef<THREE.LineBasicMaterial>(null)
  const performanceMode = useVisualStore((s) => s.performanceMode)
  const n = VERTICES_BY_MODE[performanceMode]

  // 低频环 (y=0.8) 与中高频环 (y=-0.8)
  const lowGeo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const positions = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      const angle = (i / n) * Math.PI * 2
      positions[i * 3] = Math.cos(angle) * 4
      positions[i * 3 + 1] = 0.8
      positions[i * 3 + 2] = Math.sin(angle) * 4
    }
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    return g
  }, [n])

  const highGeo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const positions = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      const angle = (i / n) * Math.PI * 2
      positions[i * 3] = Math.cos(angle) * 4
      positions[i * 3 + 1] = -0.8
      positions[i * 3 + 2] = Math.sin(angle) * 4
    }
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    return g
  }, [n])

  // 性能档切换/卸载时释放旧 geometry 的 GPU buffer（geometry 以 prop 传入，r3f 不会自动 dispose）
  useEffect(() => () => lowGeo.dispose(), [lowGeo])
  useEffect(() => () => highGeo.dispose(), [highGeo])

  const hueRef = useRef(Math.random())

  useFrame((_, delta) => {
    const engine = usePlayerStore.getState()._engine()
    const freqData = engine.getFrequencyData()
    const energy = bassEnergyFrom(freqData)

    hueRef.current += delta * (0.08 + energy * 0.12)

    // 低频环: 用低频段频谱 (bins 0..n)
    const lowSpectrum = spectrumSlice(freqData, 0, n)
    const lowPosAttr = lowGeo.attributes.position as THREE.BufferAttribute
    const lowPosArr = lowPosAttr.array as Float32Array
    for (let i = 0; i < n; i++) {
      const angle = (i / n) * Math.PI * 2
      const amp = lowSpectrum[i]
      const radius = 3.5 + amp * 5
      lowPosArr[i * 3] = Math.cos(angle) * radius
      lowPosArr[i * 3 + 1] = 0.8
      lowPosArr[i * 3 + 2] = Math.sin(angle) * radius
    }
    lowPosAttr.needsUpdate = true

    // 中高频环: 用中高频段频谱 (bins 64..64+n)
    const highSpectrum = spectrumSlice(freqData, 64, n)
    const highPosAttr = highGeo.attributes.position as THREE.BufferAttribute
    const highPosArr = highPosAttr.array as Float32Array
    for (let i = 0; i < n; i++) {
      const angle = (i / n) * Math.PI * 2
      const amp = highSpectrum[i]
      const radius = 3 + amp * 4
      highPosArr[i * 3] = Math.cos(angle) * radius
      highPosArr[i * 3 + 1] = -0.8
      highPosArr[i * 3 + 2] = Math.sin(angle) * radius
    }
    highPosAttr.needsUpdate = true

    const hue = hueRef.current % 1
    if (lowMatRef.current) {
      lowMatRef.current.color.setHSL(hue, 0.8, 0.45 + energy * 0.35)
    }
    if (highMatRef.current) {
      highMatRef.current.color.setHSL((hue + 0.3) % 1, 0.7, 0.4 + energy * 0.3)
    }

    if (ringLowRef.current) {
      ringLowRef.current.rotation.y += delta * (0.08 + energy * 0.15)
      ringLowRef.current.rotation.x += delta * 0.02
    }
    if (ringHighRef.current) {
      ringHighRef.current.rotation.y -= delta * (0.06 + energy * 0.12)
      ringHighRef.current.rotation.x -= delta * 0.015
    }
  })

  return (
    <group>
      <lineLoop ref={ringLowRef} geometry={lowGeo}>
        <lineBasicMaterial ref={lowMatRef} color="#7ec8f8" transparent opacity={0.9} depthWrite={false} />
      </lineLoop>
      <lineLoop ref={ringHighRef} geometry={highGeo}>
        <lineBasicMaterial ref={highMatRef} color="#f8a07e" transparent opacity={0.75} depthWrite={false} />
      </lineLoop>
    </group>
  )
}
