import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useVisualStore } from '../../stores/visual'
import { useSettingsStore } from '../../stores/settings'
import { usePlayerStore } from '../../stores/player'
import { getDotSpriteTexture } from '../../lib/dot-texture'
import type { PerformanceMode } from '../../types/domain'

/**
 * 音箱沙粒效果。粒子运动全部在顶点着色器中完成，主线程只更新少量 uniform；
 * 避免起声时逐帧遍历、随机化并上传数万颗粒子的 position buffer。
 */

const COUNT_BY_MODE: Record<PerformanceMode, number> = {
  eco: 16000,
  balanced: 32000,
  high: 55000,
  ultra: 90000
}

const vertexShader = /* glsl */ `
  uniform float uTime, uEnergy, uMotion, uSize, uPixel;
  attribute vec4 aParticle;
  varying float vLife;

  void main() {
    float angle = aParticle.x;
    float baseRadius = aParticle.y;
    float phase = aParticle.z;
    float lift = aParticle.w;
    float drive = smoothstep(0.018, 0.62, uEnergy) * uMotion;
    float speed = 0.09 + drive * (0.18 + lift * 0.13);
    float life = fract(phase + uTime * speed);
    float easedLife = life * life * (3.0 - 2.0 * life);
    float radius = baseRadius + easedLife * drive * (5.8 + lift * 1.8);
    float wobble = sin(uTime * (0.45 + lift * 0.22) + phase * 21.0) * 0.08 * drive;
    float y = sin(life * 3.14159265) * drive * (0.8 + lift * 2.2);
    vec3 p = vec3(cos(angle + wobble) * radius, y, sin(angle + wobble) * radius);

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = clamp(uSize * uPixel * (18.0 / max(1.0, -mv.z)) * (0.8 + lift * 0.45), 0.7, 8.0);
    gl_Position = projectionMatrix * mv;
    vLife = life;
  }
`

const fragmentShader = /* glsl */ `
  uniform sampler2D uDotTex;
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vLife;

  void main() {
    vec4 dot = texture2D(uDotTex, gl_PointCoord);
    if (dot.a < 0.02) discard;
    float lifeFade = smoothstep(0.0, 0.08, vLife) * (1.0 - smoothstep(0.78, 1.0, vLife));
    gl_FragColor = vec4(uColor * (0.88 + lifeFade * 0.3), dot.a * uOpacity * (0.38 + lifeFade * 0.62));
  }
`

function averageFrequency(): number {
  const data = usePlayerStore.getState()._frequencyData()
  if (!data.length) return 0
  let sum = 0
  for (let i = 0; i < data.length; i++) sum += data[i]
  return sum / data.length / 255
}

export function SpeakerParticles({ lightBackground = false }: { lightBackground?: boolean }) {
  const pointsRef = useRef<THREE.Points>(null)
  const energyRef = useRef(0)
  const performanceMode = useVisualStore((s) => s.performanceMode)
  const countScale = useSettingsStore((s) => s.lyrics3d.particleCount)
  const count = THREE.MathUtils.clamp(
    Math.round(COUNT_BY_MODE[performanceMode] * countScale),
    4000,
    180000
  )

  const geometry = useMemo(() => {
    const positions = new Float32Array(count * 3)
    const particles = new Float32Array(count * 4)
    for (let i = 0; i < count; i++) {
      const off = i * 4
      particles[off] = Math.random() * Math.PI * 2
      particles[off + 1] = 0.08 + Math.sqrt(Math.random()) * 0.92
      particles[off + 2] = Math.random()
      particles[off + 3] = Math.random()
    }
    const result = new THREE.BufferGeometry()
    result.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    result.setAttribute('aParticle', new THREE.BufferAttribute(particles, 4))
    result.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 12)
    return result
  }, [count])
  useEffect(() => () => geometry.dispose(), [geometry])

  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uEnergy: { value: 0 },
    uMotion: { value: 1 },
    uSize: { value: 1 },
    uPixel: { value: 1 },
    uOpacity: { value: 0.86 },
    uColor: { value: new THREE.Color('#7ec8f8') },
    uDotTex: { value: getDotSpriteTexture() }
  }), [])

  const dpr = useThree((s) => s.viewport.dpr)
  useEffect(() => {
    uniforms.uPixel.value = dpr
  }, [dpr, uniforms])

  useFrame((state, delta) => {
    const params = useSettingsStore.getState().lyrics3d
    const rawEnergy = averageFrequency()
    const rate = rawEnergy > energyRef.current ? 1 - Math.exp(-delta * 5.2) : 1 - Math.exp(-delta * 2.6)
    energyRef.current += (rawEnergy - energyRef.current) * rate

    uniforms.uTime.value = state.clock.getElapsedTime()
    uniforms.uEnergy.value = energyRef.current
    uniforms.uMotion.value = params.motionIntensity
    uniforms.uSize.value = params.particleSize
    uniforms.uOpacity.value = 0.82
    const brightnessScale = 0.72 + params.particleBrightness * 0.35
    uniforms.uColor.value.setHSL(
      (0.55 + energyRef.current * 0.15) % 1,
      0.72,
      lightBackground
        ? Math.min(0.78, (0.58 + energyRef.current * 0.16) * brightnessScale)
        : Math.min(0.92, (0.42 + energyRef.current * 0.28) * brightnessScale)
    )

    if (pointsRef.current) {
      pointsRef.current.rotation.y += delta * (0.08 + energyRef.current * 0.08)
      pointsRef.current.rotation.x = -0.35
    }
  })

  return (
    <points ref={pointsRef} geometry={geometry} frustumCulled={false}>
      <shaderMaterial
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={lightBackground ? THREE.NormalBlending : THREE.AdditiveBlending}
      />
    </points>
  )
}
