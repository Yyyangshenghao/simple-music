import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useVisualStore } from '../../stores/visual'
import { usePlayerStore } from '../../stores/player'
import { api } from '../../lib/api'
import { bandEnergiesFrom } from '../../lib/audio-energy'
import type { PerformanceMode } from '../../types/domain'

/**
 * 封面粒子云：把封面像素铺成一面正对相机的密集网格粒子墙，GLSL shader 按
 * 7 个频段驱动逐粒子沿 Z 轴朝镜头弹跳（低频在中心/高频在外圈），叠加鼓点
 * 涟漪扩散与一层辉光。相机由本组件自己接管（固定机位 + 轻摇晃），
 * CinemaCamera 在 cover-cloud 生效时会让位，见 CinemaCamera.tsx。
 */

// 粒子数 = gridSize²，是这个场景 GPU 开销的主要来源（两层点云叠加渲染）。
// 档位下调过一轮：balanced 从 130→104（粒子数降至 ~64%），其余同比例收紧。
const GRID_SIZE_BY_MODE: Record<PerformanceMode, number> = {
  eco: 72,
  balanced: 104,
  high: 128,
  ultra: 152
}

const SPACING = 0.5
const FOV = 60
const RIPPLE_COUNT = 6
const RIPPLE_DURATION = 0.55
const BEAT_THRESHOLD = 0.38
const BEAT_MIN_INTERVAL = 0.1
const FRAME_INTERVAL_MS = 1000 / 30

const particleVertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uSubBass;
  uniform float uBass;
  uniform float uLowMid;
  uniform float uMid;
  uniform float uHighMid;
  uniform float uPresence;
  uniform float uAir;
  uniform float uEnergy;
  uniform float uGridHalf;
  uniform float uSpacing;
  uniform float uFocal;
  uniform float uDotScale;

  #define RIPPLE_COUNT 6
  uniform float uRippleTime[RIPPLE_COUNT];
  uniform float uRippleStrength[RIPPLE_COUNT];
  uniform vec2 uRippleCenter[RIPPLE_COUNT];
  uniform float uRippleBlast[RIPPLE_COUNT];

  attribute vec3 aColor;
  attribute float aBrightness;
  attribute float aRandom;

  varying vec3 vColor;
  varying float vLift;

  void main() {
    vColor = aColor;

    vec3 pos = position;
    float centerDist = length(pos.xy);
    float normDist = clamp(centerDist / uGridHalf, 0.0, 1.0);

    // 径向分频：中心吃低频、外圈吃高频，让弹跳在画面上有空间层次
    float innerRegion = smoothstep(0.6, 0.0, normDist);
    float midRegion = smoothstep(0.0, 0.5, normDist) * smoothstep(1.0, 0.45, normDist);
    float outerRegion = smoothstep(0.45, 1.0, normDist);

    float lift = 0.0;
    lift += (uSubBass + uBass) * innerRegion * 11.0;
    lift += (uLowMid + uMid) * midRegion * 9.0;
    lift += (uHighMid + uPresence + uAir) * outerRegion * 7.5;

    // 每颗粒子的有机微抖 + 一个缓慢呼吸，安静时也不死板
    float phase = aRandom * 6.2831853;
    float shimmer = sin(uTime * 6.0 + phase + centerDist * 0.18);
    lift += shimmer * uEnergy * 4.0;
    lift += sin(uTime * 1.4 + phase) * 0.35;

    // 越亮的像素弹得越高，暗部保留底噪
    lift *= 0.5 + aBrightness * 0.8;

    // 鼓点涟漪：每道环从各自的随机爆点向外扩散，多点并发
    float ringWidth = uGridHalf * 0.12;
    float rippleEnv = 0.0;
    vec2 flyDir = vec2(0.0);
    float blast = 0.0;
    for (int r = 0; r < RIPPLE_COUNT; r++) {
      vec2 toCenter = pos.xy - uRippleCenter[r];
      float dist = length(toCenter);
      float rad = uRippleTime[r] * (uGridHalf / 0.45);
      float ring = exp(-pow((dist - rad) / ringWidth, 2.0)) * uRippleStrength[r];
      lift += ring * 6.5;
      if (ring > rippleEnv) {
        rippleEnv = ring;
        flyDir = dist > 0.001 ? toCenter / dist : vec2(0.0);
        blast = uRippleBlast[r];
      }
    }

    // 粒子飞出：强鼓点触发命中粒子短暂飞散，环移走后自然回落
    float flyThreshold = mix(0.85, 0.5, blast);
    float flySelect = step(flyThreshold, aRandom);
    float fly = rippleEnv * flySelect;
    pos.xy += flyDir * fly * mix(7.0, 16.0, blast);
    lift += fly * (5.0 + blast * 6.0);

    pos.z += lift;
    vLift = lift;

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    // 点尺寸 = 网格间距投影 * 圆点缩放（<1 留出间隙）* 音频涨缩
    float audioBoost = 1.0 + (uSubBass + uBass) * 0.4 + uEnergy * 0.2;
    gl_PointSize = (uSpacing * uFocal / -mvPosition.z) * uDotScale * audioBoost;
  }
`

const particleFragmentShader = /* glsl */ `
  varying vec3 vColor;
  varying float vLift;

  void main() {
    float d = length(gl_PointCoord - vec2(0.5));
    if (d > 0.5) discard;
    float edge = smoothstep(0.5, 0.36, d);

    vec3 color = vColor * (1.0 + clamp(vLift, 0.0, 8.0) * 0.05);
    gl_FragColor = vec4(color, edge);
  }
`

const bloomFragmentShader = /* glsl */ `
  varying vec3 vColor;
  varying float vLift;

  void main() {
    float d = length(gl_PointCoord - vec2(0.5));
    if (d > 0.5) discard;
    float soft = smoothstep(0.5, 0.0, d);
    float glow = clamp(vLift, 0.0, 8.0) * 0.09;
    gl_FragColor = vec4(vColor * (0.45 + glow), soft * glow * 0.4);
  }
`

function buildGeometry(gridSize: number): THREE.BufferGeometry {
  const count = gridSize * gridSize
  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  const brightness = new Float32Array(count)
  const randoms = new Float32Array(count)
  const half = (gridSize * SPACING) / 2

  let i = 0
  for (let gx = 0; gx < gridSize; gx++) {
    for (let gy = 0; gy < gridSize; gy++) {
      positions[i * 3] = gx * SPACING - half
      positions[i * 3 + 1] = gy * SPACING - half
      positions[i * 3 + 2] = 0
      colors[i * 3] = 0.12
      colors[i * 3 + 1] = 0.13
      colors[i * 3 + 2] = 0.17
      brightness[i] = 0.15
      randoms[i] = Math.random()
      i++
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3))
  geometry.setAttribute('aBrightness', new THREE.BufferAttribute(brightness, 1))
  geometry.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1))
  return geometry
}

type IdleHandle = number | null

function requestIdle(cb: () => void): IdleHandle {
  if (typeof window.requestIdleCallback === 'function') {
    return window.requestIdleCallback(cb, { timeout: 100 })
  }
  return window.setTimeout(cb, 16)
}

function cancelIdle(handle: IdleHandle) {
  if (handle == null) return
  if (typeof window.cancelIdleCallback === 'function') {
    window.cancelIdleCallback(handle)
  } else {
    window.clearTimeout(handle)
  }
}

interface CoverParticleCloudProps {
  coverUrl?: string
}

export function CoverParticleCloud({ coverUrl }: CoverParticleCloudProps) {
  const performanceMode = useVisualStore((s) => s.performanceMode)
  const gridSize = GRID_SIZE_BY_MODE[performanceMode]
  const throttle = performanceMode === 'eco' || performanceMode === 'balanced'

  const tiltGroupRef = useRef<THREE.Group>(null)
  const spinGroupRef = useRef<THREE.Group>(null)

  const prevBassRef = useRef(0)
  const lastBeatRef = useRef(-99)
  const rippleSlotRef = useRef(0)
  const rippleStartsRef = useRef(new Float32Array(RIPPLE_COUNT).fill(-99))
  const ripplePeakRef = useRef(new Float32Array(RIPPLE_COUNT))
  const lastFrameTimeRef = useRef(0)

  const proxyUrl = coverUrl ? api.url('/proxy/cover', { url: coverUrl }) : undefined

  // geometry 只在性能档切换时重建，卸载/切档时释放 GPU buffer
  const geometry = useMemo(() => buildGeometry(gridSize), [gridSize])
  useEffect(() => () => geometry.dispose(), [geometry])

  const uniforms = useMemo(() => {
    const half = (gridSize * SPACING) / 2
    return {
      uTime: { value: 0 },
      uSubBass: { value: 0 },
      uBass: { value: 0 },
      uLowMid: { value: 0 },
      uMid: { value: 0 },
      uHighMid: { value: 0 },
      uPresence: { value: 0 },
      uAir: { value: 0 },
      uEnergy: { value: 0 },
      uGridHalf: { value: half },
      uSpacing: { value: SPACING },
      uFocal: { value: 1000 },
      uDotScale: { value: 0.42 },
      uRippleTime: { value: new Float32Array(RIPPLE_COUNT).fill(99) },
      uRippleStrength: { value: new Float32Array(RIPPLE_COUNT) },
      uRippleCenter: {
        value: Array.from({ length: RIPPLE_COUNT }, () => new THREE.Vector2(9999, 9999))
      },
      uRippleBlast: { value: new Float32Array(RIPPLE_COUNT) }
    }
  }, [gridSize])

  // 辉光层与主层共享同名频段/涟漪 uniform 对象，只有 uDotScale 各自独立
  const bloomUniforms = useMemo(
    () => ({ ...uniforms, uDotScale: { value: 1.15 } }),
    [uniforms]
  )

  // 性能档切换重建网格时，涟漪/节拍状态一并复位，避免旧涟漪在新网格上突然出现
  useEffect(() => {
    rippleSlotRef.current = 0
    prevBassRef.current = 0
    lastBeatRef.current = -99
    rippleStartsRef.current.fill(-99)
    ripplePeakRef.current.fill(0)
  }, [gridSize])

  // 采样封面像素并分帧写入 aColor/aBrightness，避免高密度网格切歌瞬间掉帧
  useEffect(() => {
    if (!proxyUrl) return

    const n = gridSize
    const sampleCanvas = document.createElement('canvas')
    sampleCanvas.width = n
    sampleCanvas.height = n
    const sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true })
    if (!sampleCtx) return

    let disposed = false
    let rebuildToken = 0
    let rebuildHandle: IdleHandle = null

    function rebuildChunk(pixels: Uint8ClampedArray, token: number, startGx: number) {
      if (disposed || token !== rebuildToken) return
      const colorAttr = geometry.getAttribute('aColor') as THREE.BufferAttribute
      const brightAttr = geometry.getAttribute('aBrightness') as THREE.BufferAttribute
      const colorArr = colorAttr.array as Float32Array
      const brightArr = brightAttr.array as Float32Array
      const chunkCols = 32
      const endGx = Math.min(startGx + chunkCols, n)

      for (let gx = startGx; gx < endGx; gx++) {
        for (let gy = 0; gy < n; gy++) {
          const i = gx * n + gy
          const px = gx
          const py = n - 1 - gy
          const p = (py * n + px) * 4
          const r = pixels[p] / 255
          const g = pixels[p + 1] / 255
          const b = pixels[p + 2] / 255
          colorArr[i * 3] = r
          colorArr[i * 3 + 1] = g
          colorArr[i * 3 + 2] = b
          brightArr[i] = (r + g + b) / 3
        }
      }
      colorAttr.needsUpdate = true
      brightAttr.needsUpdate = true

      if (endGx < n) {
        rebuildHandle = requestIdle(() => rebuildChunk(pixels, token, endGx))
      } else {
        rebuildHandle = null
      }
    }

    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      if (disposed) return
      sampleCtx.clearRect(0, 0, n, n)
      try {
        sampleCtx.drawImage(img, 0, 0, n, n)
      } catch {
        return
      }
      let pixels: Uint8ClampedArray
      try {
        pixels = sampleCtx.getImageData(0, 0, n, n).data
      } catch {
        return
      }
      cancelIdle(rebuildHandle)
      rebuildToken += 1
      rebuildChunk(pixels, rebuildToken, 0)
    }
    img.src = proxyUrl

    // 切歌/卸载时取消在途重建与图片加载，防止旧封面回调晚到覆盖新采样
    return () => {
      disposed = true
      cancelIdle(rebuildHandle)
      img.onload = null
      img.src = ''
    }
  }, [proxyUrl, gridSize, geometry])

  useFrame((state) => {
    // 固定机位正对粒子墙（随网格半宽自适应距离），相机由本组件接管
    const half = (gridSize * SPACING) / 2
    const dist = half / Math.tan(THREE.MathUtils.degToRad(FOV) / 2)
    state.camera.position.set(0, 0, dist * 1.12)
    state.camera.lookAt(0, 0, 0)

    const t = state.clock.getElapsedTime()

    // 正面小幅摇晃：绕 X/Y/Z 轻微摆动，非整圈旋转，保持封面正对镜头可辨识
    if (spinGroupRef.current) {
      spinGroupRef.current.rotation.x = Math.sin(t * 0.5) * 0.06
      spinGroupRef.current.rotation.y = Math.cos(t * 0.4) * 0.07
      spinGroupRef.current.rotation.z = Math.sin(t * 0.3) * 0.02
    }

    // 仅 eco/balanced 档节流：跳过本帧的频段计算/涟漪推进/uniform 写入
    if (throttle) {
      const nowMs = performance.now()
      if (nowMs - lastFrameTimeRef.current < FRAME_INTERVAL_MS) return
      lastFrameTimeRef.current = nowMs
    }

    uniforms.uTime.value = t
    uniforms.uFocal.value =
      state.gl.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(FOV) / 2))

    const engine = usePlayerStore.getState()._engine()
    const bands = bandEnergiesFrom(engine.getFrequencyData())
    uniforms.uSubBass.value = bands.subBass
    uniforms.uBass.value = bands.bass
    uniforms.uLowMid.value = bands.lowMid
    uniforms.uMid.value = bands.mid
    uniforms.uHighMid.value = bands.highMid
    uniforms.uPresence.value = bands.presence
    uniforms.uAir.value = bands.air
    uniforms.uEnergy.value = bands.energy

    // 鼓点上升沿检测：低频突破阈值且与上次间隔足够时，触发一道新涟漪
    const bass = bands.subBass + bands.bass
    if (
      bass > BEAT_THRESHOLD &&
      prevBassRef.current <= BEAT_THRESHOLD &&
      t - lastBeatRef.current > BEAT_MIN_INTERVAL
    ) {
      const slot = rippleSlotRef.current
      rippleStartsRef.current[slot] = t
      const center = uniforms.uRippleCenter.value[slot]
      center.set((Math.random() * 2 - 1) * half * 0.55, (Math.random() * 2 - 1) * half * 0.55)
      ripplePeakRef.current[slot] = THREE.MathUtils.clamp((bass - BEAT_THRESHOLD) / 1.2, 0.65, 1.0)
      uniforms.uRippleBlast.value[slot] = THREE.MathUtils.clamp((bass - 1.0) / 0.8, 0, 1)
      rippleSlotRef.current = (slot + 1) % RIPPLE_COUNT
      lastBeatRef.current = t
    }
    prevBassRef.current = bass

    // 涟漪推进：每个槽位按自身鼓点时刻计算扩散秒数，强度线性衰减
    const rippleTimeArr = uniforms.uRippleTime.value
    const rippleStrengthArr = uniforms.uRippleStrength.value
    for (let k = 0; k < RIPPLE_COUNT; k++) {
      const age = t - rippleStartsRef.current[k]
      rippleTimeArr[k] = age
      rippleStrengthArr[k] = ripplePeakRef.current[k] * Math.max(0, 1 - age / RIPPLE_DURATION)
    }
  })

  return (
    <group ref={tiltGroupRef}>
      <group ref={spinGroupRef}>
        <points geometry={geometry} renderOrder={0}>
          <shaderMaterial
            vertexShader={particleVertexShader}
            fragmentShader={bloomFragmentShader}
            uniforms={bloomUniforms}
            transparent
            depthWrite={false}
            depthTest={false}
            blending={THREE.AdditiveBlending}
          />
        </points>
        <points geometry={geometry} renderOrder={1}>
          <shaderMaterial
            vertexShader={particleVertexShader}
            fragmentShader={particleFragmentShader}
            uniforms={uniforms}
            transparent
            depthWrite
            depthTest
          />
        </points>
      </group>
    </group>
  )
}
