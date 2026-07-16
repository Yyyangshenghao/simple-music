import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Bloom, EffectComposer, ToneMapping } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import * as THREE from 'three'
import { useVisualStore } from '../../stores/visual'
import { useSettingsStore } from '../../stores/settings'
import { usePlayerStore } from '../../stores/player'
import { api } from '../../lib/api'
import { bandEnergiesFrom } from '../../lib/audio-energy'
import type { PerformanceMode } from '../../types/domain'

/**
 * 封面粒子云：把封面像素铺成一面正对相机的密集网格粒子墙，GLSL shader 按
 * 7 个频段驱动逐粒子沿 Z 轴朝镜头弹跳（低频在中心/高频在外圈），叠加鼓点
 * 涟漪扩散与辉光。相机由本组件自己接管（固定机位 + 轻摇晃），
 * CinemaCamera 在 cover-cloud 生效时会让位，见 CinemaCamera.tsx。
 *
 * 渲染管线分两档：
 * - eco/balanced：单 draw call 点云，辉光内嵌在 sprite 里（安静时点径收缩到
 *   实心核大小，光晕区零填充开销）。
 * - high/ultra：同一 draw call 只画实心核，辉光交给 postprocessing 的半分辨率
 *   mipmap Bloom + ACES 色调映射（开销随分辨率走，不随粒子数涨）。
 */

// 粒子数 = gridSize²，是这个场景 GPU 开销的主要来源。
// 档位下调过一轮：balanced 从 130→104（粒子数降至 ~64%），其余同比例收紧。
const GRID_SIZE_BY_MODE: Record<PerformanceMode, number> = {
  eco: 72,
  balanced: 104,
  high: 128,
  ultra: 152
}

const SPACING = 0.5
const FOV = 60
// shader 数组 uniform 的槽位上限;实际同屏并发数由设置 lyrics3d.rippleCount 决定(≤该值)
const RIPPLE_COUNT = 6
const BEAT_MIN_INTERVAL = 0.1
const FRAME_INTERVAL_MS = 1000 / 30
const BASE_DOT_SCALE = 0.3
const BASE_HALO_DOT_SCALE = 0.82

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
  uniform float uHaloScale;
  uniform float uSpriteHalo;
  uniform float uLiftScale;

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
  varying float vCoreFrac;
  varying float vHalo;

  void main() {
    vColor = aColor;

    vec3 pos = position;
    float centerDist = length(pos.xy);
    float normDist = clamp(centerDist / uGridHalf, 0.0, 1.0);

    // 静态浮雕：亮像素微微凸向镜头，让平面封面带一层立体起伏
    pos.z += (aBrightness - 0.45) * 2.6;

    // 径向分频：中心吃低频、外圈吃高频，让弹跳在画面上有空间层次
    float innerRegion = smoothstep(0.6, 0.0, normDist);
    float midRegion = smoothstep(0.0, 0.5, normDist) * smoothstep(1.0, 0.45, normDist);
    float outerRegion = smoothstep(0.45, 1.0, normDist);

    float lift = 0.0;
    lift += (uSubBass + uBass) * innerRegion * 11.0;
    lift += (uLowMid + uMid) * midRegion * 9.0;
    lift += (uHighMid + uPresence + uAir) * outerRegion * 7.5;

    // 连贯波场：相位由空间位置而非随机数决定，相邻粒子同步起伏；
    // 两组斜向行波叠加出缓慢的干涉图样，整体像一块随音乐呼吸的布，
    // 取代原先每粒子随机相位的高频微抖（视觉上"各跳各的"很混乱）
    float w1 = sin(uTime * 2.6 + pos.x * 0.20 + pos.y * 0.12);
    float w2 = sin(uTime * 1.9 - pos.y * 0.17 + pos.x * 0.07);
    lift += (w1 + w2) * 0.5 * uEnergy * 4.0;
    lift += sin(uTime * 1.2 + centerDist * 0.10) * 0.35;

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
    pos.xy += flyDir * fly * mix(7.0, 16.0, blast) * uLiftScale;
    lift += fly * (5.0 + blast * 6.0);

    // 动效强度倍率:统一缩放弹跳/涟漪/飞散的位移幅度
    lift *= uLiftScale;
    pos.z += lift;
    vLift = lift;

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    // 点尺寸 = 网格间距投影 * 圆点缩放（<1 留出间隙）* 音频涨缩
    float audioBoost = 1.0 + (uSubBass + uBass) * 0.4 + uEnergy * 0.2;
    // sprite 内嵌辉光(uSpriteHalo=1 时生效):lift 小的粒子点径收缩到实心核
    // 大小,光晕区零填充;lift 大时 sprite 扩张出光晕环带,由片元画核+晕两层
    float haloVis = smoothstep(0.35, 1.4, lift) * uSpriteHalo;
    float dotScale = max(mix(uDotScale, uHaloScale, haloVis), 1e-4);
    vHalo = haloVis;
    vCoreFrac = 0.5 * uDotScale / dotScale;
    gl_PointSize = (uSpacing * uFocal / -mvPosition.z) * dotScale * audioBoost;
  }
`

const particleFragmentShader = /* glsl */ `
  uniform float uBrightness;
  uniform float uGlow;
  uniform float uSrgbDecode;

  varying vec3 vColor;
  varying float vLift;
  varying float vCoreFrac;
  varying float vHalo;

  void main() {
    float d = length(gl_PointCoord - vec2(0.5));
    if (d > 0.5) discard;

    // 后期 Bloom 管线按线性色彩空间处理,把 sRGB 采样色解码为线性,
    // composer 末端统一编码回 sRGB;sprite 辉光路径(uSrgbDecode=0)保持原值直出
    vec3 base = mix(vColor, pow(vColor, vec3(2.2)), uSrgbDecode);

    float liftC = clamp(vLift, 0.0, 8.0);
    float core = smoothstep(vCoreFrac, vCoreFrac * 0.72, d);
    vec3 coreCol = base * uBrightness * (1.0 + liftC * 0.05);

    float glow = liftC * 0.09;
    float haloA = smoothstep(0.5, 0.0, d) * vHalo * glow * 0.4 * uGlow;
    vec3 haloCol = base * (0.45 + glow) * uBrightness;

    // 预乘输出 + (ONE, ONE_MINUS_SRC_ALPHA):实心核遮挡背景,光晕纯加光,
    // 一次混合等价于旧版"普通混合主层 + 加法混合辉光层"两个 draw call
    gl_FragColor = vec4(coreCol * core + haloCol * haloA, core);
  }
`

function buildGeometry(gridSize: number): THREE.BufferGeometry {
  const count = gridSize * gridSize
  const positions = new Float32Array(count * 3)
  // 颜色/亮度用 uint8 归一化属性,显存与上传带宽为 float32 的 1/4
  const colors = new Uint8Array(count * 3)
  const brightness = new Uint8Array(count)
  const randoms = new Float32Array(count)
  const half = (gridSize * SPACING) / 2

  let i = 0
  for (let gx = 0; gx < gridSize; gx++) {
    for (let gy = 0; gy < gridSize; gy++) {
      positions[i * 3] = gx * SPACING - half
      positions[i * 3 + 1] = gy * SPACING - half
      positions[i * 3 + 2] = 0
      colors[i * 3] = 31
      colors[i * 3 + 1] = 33
      colors[i * 3 + 2] = 43
      brightness[i] = 38
      randoms[i] = Math.random()
      i++
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3, true))
  geometry.setAttribute('aBrightness', new THREE.BufferAttribute(brightness, 1, true))
  geometry.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1))
  return geometry
}

interface CoverParticleCloudProps {
  coverUrl?: string
}

export function CoverParticleCloud({ coverUrl }: CoverParticleCloudProps) {
  const performanceMode = useVisualStore((s) => s.performanceMode)
  const backgroundColor = useVisualStore((s) => s.fx.backgroundColor)
  // 粒子数量倍率作用于总粒子数(gridSize²),故对 gridSize 开平方;变化时重建 geometry
  const countScale = useSettingsStore((s) => s.lyrics3d.particleCount)
  const gridSize = THREE.MathUtils.clamp(
    Math.round(GRID_SIZE_BY_MODE[performanceMode] * Math.sqrt(countScale)),
    24,
    216
  )
  const throttle = performanceMode === 'eco' || performanceMode === 'balanced'
  const glowStrength = useSettingsStore((s) => s.lyrics3d.glowStrength)
  const glowDisabled = glowStrength <= 0.01
  // high/ultra 走真 Bloom 后期管线;eco/balanced(或辉光关闭)走 sprite 内嵌辉光
  const postBloom = !throttle && !glowDisabled

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
      uDotScale: { value: BASE_DOT_SCALE },
      uHaloScale: { value: BASE_HALO_DOT_SCALE },
      uSpriteHalo: { value: 1 },
      uLiftScale: { value: 1 },
      uBrightness: { value: 1 },
      uGlow: { value: 1 },
      uSrgbDecode: { value: 0 },
      uRippleTime: { value: new Float32Array(RIPPLE_COUNT).fill(99) },
      uRippleStrength: { value: new Float32Array(RIPPLE_COUNT) },
      uRippleCenter: {
        value: Array.from({ length: RIPPLE_COUNT }, () => new THREE.Vector2(9999, 9999))
      },
      uRippleBlast: { value: new Float32Array(RIPPLE_COUNT) }
    }
  }, [gridSize])

  // 渲染管线切换只动 uniform,不重建材质/geometry
  useEffect(() => {
    uniforms.uSpriteHalo.value = postBloom || glowDisabled ? 0 : 1
    uniforms.uSrgbDecode.value = postBloom ? 1 : 0
  }, [postBloom, glowDisabled, uniforms])

  // gl_PointSize 以物理像素计,焦距只在画布尺寸/dpr 变化时更新,不必每帧读 DOM
  const size = useThree((s) => s.size)
  const dpr = useThree((s) => s.viewport.dpr)
  useEffect(() => {
    uniforms.uFocal.value = (size.height * dpr) / (2 * Math.tan(THREE.MathUtils.degToRad(FOV) / 2))
  }, [size.height, dpr, uniforms])

  // 后期管线需要不透明的场景底色:透明画布经 Bloom 合成会丢 alpha 变黑,
  // 用与外层 div 相同的底色填充 scene.background,视觉无缝
  const scene = useThree((s) => s.scene)
  useEffect(() => {
    if (!postBloom) return
    const prev = scene.background
    scene.background = new THREE.Color(backgroundColor || '#05060c')
    return () => {
      scene.background = prev
    }
  }, [postBloom, backgroundColor, scene])

  // 性能档切换重建网格时，涟漪/节拍状态一并复位，避免旧涟漪在新网格上突然出现
  useEffect(() => {
    rippleSlotRef.current = 0
    prevBassRef.current = 0
    lastBeatRef.current = -99
    rippleStartsRef.current.fill(-99)
    ripplePeakRef.current.fill(0)
  }, [gridSize])

  // 采样封面像素一次性写入 aColor/aBrightness:最大网格 216²≈4.7 万像素的
  // 循环 <1ms,GPU 全量上传也只发生一次,同步写完即换,切歌无可见扫描过程。
  // (曾用 requestIdleCallback 分帧写入,但渲染负载高时每块要等满 100ms 超时,
  // 切歌变成持续半秒以上的可见列扫描,反而更糟)
  useEffect(() => {
    if (!proxyUrl) return

    const n = gridSize
    const sampleCanvas = document.createElement('canvas')
    sampleCanvas.width = n
    sampleCanvas.height = n
    const sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true })
    if (!sampleCtx) return

    let disposed = false

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

      const colorAttr = geometry.getAttribute('aColor') as THREE.BufferAttribute
      const brightAttr = geometry.getAttribute('aBrightness') as THREE.BufferAttribute
      const colorArr = colorAttr.array as Uint8Array
      const brightArr = brightAttr.array as Uint8Array
      for (let gx = 0; gx < n; gx++) {
        for (let gy = 0; gy < n; gy++) {
          const i = gx * n + gy
          const p = ((n - 1 - gy) * n + gx) * 4
          const r = pixels[p]
          const g = pixels[p + 1]
          const b = pixels[p + 2]
          colorArr[i * 3] = r
          colorArr[i * 3 + 1] = g
          colorArr[i * 3 + 2] = b
          brightArr[i] = (r + g + b) / 3
        }
      }
      colorAttr.needsUpdate = true
      brightAttr.needsUpdate = true
    }
    img.src = proxyUrl

    // 切歌/卸载时废弃在途图片加载，防止旧封面回调晚到覆盖新采样
    return () => {
      disposed = true
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

    const params = useSettingsStore.getState().lyrics3d

    uniforms.uTime.value = t
    uniforms.uDotScale.value = BASE_DOT_SCALE * params.particleSize
    uniforms.uHaloScale.value = BASE_HALO_DOT_SCALE * params.particleSize
    uniforms.uLiftScale.value = params.motionIntensity
    uniforms.uBrightness.value = params.particleBrightness
    uniforms.uGlow.value = params.glowStrength

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

    // 鼓点上升沿检测：低频突破阈值且与上次间隔足够时，触发一道新涟漪。
    // 阈值随灵敏度线性下降:灵敏度 0.5 时为历史默认 0.38
    const beatThreshold = 0.58 - 0.4 * params.rippleSensitivity
    const activeRipples = THREE.MathUtils.clamp(Math.round(params.rippleCount), 1, RIPPLE_COUNT)
    const bass = bands.subBass + bands.bass
    if (
      bass > beatThreshold &&
      prevBassRef.current <= beatThreshold &&
      t - lastBeatRef.current > BEAT_MIN_INTERVAL
    ) {
      const slot = rippleSlotRef.current % activeRipples
      rippleStartsRef.current[slot] = t
      const center = uniforms.uRippleCenter.value[slot]
      center.set((Math.random() * 2 - 1) * half * 0.55, (Math.random() * 2 - 1) * half * 0.55)
      ripplePeakRef.current[slot] = THREE.MathUtils.clamp((bass - beatThreshold) / 1.2, 0.65, 1.0)
      uniforms.uRippleBlast.value[slot] = THREE.MathUtils.clamp((bass - 1.0) / 0.8, 0, 1)
      rippleSlotRef.current = (slot + 1) % activeRipples
      lastBeatRef.current = t
    }
    prevBassRef.current = bass

    // 涟漪推进：每个槽位按自身鼓点时刻计算扩散秒数，强度线性衰减
    const rippleTimeArr = uniforms.uRippleTime.value
    const rippleStrengthArr = uniforms.uRippleStrength.value
    for (let k = 0; k < RIPPLE_COUNT; k++) {
      const age = t - rippleStartsRef.current[k]
      rippleTimeArr[k] = age
      rippleStrengthArr[k] = ripplePeakRef.current[k] * Math.max(0, 1 - age / params.rippleDuration)
    }
  })

  return (
    <group ref={tiltGroupRef}>
      <group ref={spinGroupRef}>
        <points geometry={geometry}>
          <shaderMaterial
            vertexShader={particleVertexShader}
            fragmentShader={particleFragmentShader}
            uniforms={uniforms}
            transparent
            depthWrite={false}
            depthTest={false}
            blending={THREE.CustomBlending}
            blendEquation={THREE.AddEquation}
            blendSrc={THREE.OneFactor}
            blendDst={THREE.OneMinusSrcAlphaFactor}
          />
        </points>
      </group>
      {postBloom && (
        <EffectComposer multisampling={0}>
          <Bloom
            mipmapBlur
            intensity={glowStrength * 0.9}
            luminanceThreshold={0.32}
            luminanceSmoothing={0.25}
            radius={0.75}
          />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        </EffectComposer>
      )}
    </group>
  )
}
