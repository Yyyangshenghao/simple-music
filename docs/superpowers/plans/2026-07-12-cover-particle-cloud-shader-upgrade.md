# 封面粒子云 Shader 化升级 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重写 `CoverParticleCloud`(封面粒子云 3D 歌词效果),用自定义 GLSL shader 实现密集网格采样(不丢暗色像素)、逐粒子七频段径向音频弹跳、鼓点涟漪、辉光叠加层,并让相机改为固定机位+轻摇晃。

**Architecture:** 保持 R3F(`@react-three/fiber`)声明式风格,不脱离现有 `<Canvas>` 共享架构。`CoverParticleCloud.tsx` 从 `pointsMaterial` + JS 端整体旋转/缩放,改为自定义 `<shaderMaterial>` + 逐粒子 GLSL 位移,并自己接管相机(`useFrame` 里直接设置 `state.camera`)。`CinemaCamera.tsx` 在 `lyrics3dEffect === 'cover-cloud'` 时短路让位。新增 `src/lib/audio-energy.ts` 的 `bandEnergiesFrom()` 把现有 1024-bin 频谱切成 7 段供 shader 使用。

**Tech Stack:** React + `@react-three/fiber` + `three`(自定义 `THREE.ShaderMaterial`,首次在本仓库引入)、vitest(逻辑单测)。

**Spec:** `docs/superpowers/specs/2026-07-12-cover-particle-cloud-shader-upgrade-design.md`

## Global Constraints

- 不新增任何 npm 依赖,不引入 postprocessing/EffectComposer。
- 不改动 `LyricsPanel.tsx`、`EffectSwitcher.tsx`、`types/domain.ts`、server 路由。
- `CoverParticleCloud` 导出名与 props 形状不变:`export function CoverParticleCloud({ coverUrl }: { coverUrl?: string })`,供 `LyricsPanel.tsx` 的 `EFFECT_COMPONENTS['cover-cloud']` 复用。
- `bandEnergiesFrom` 只服务于 `CoverParticleCloud`,不改动 `bassEnergyFrom`/`spectrumSlice`/`smoothEnergy` 现有签名与调用方(`Waveform3D.tsx` 等)。
- 每个任务的验证 = `npm run typecheck`(全量两套 tsconfig)+ `npm test`(vitest run,含新增单测)。
- 提交信息结尾加 `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`。

---

### Task 1: `bandEnergiesFrom` 七段频谱能量提取

**Files:**
- Modify: `src/lib/audio-energy.ts`
- Test: `src/lib/audio-energy.test.ts`

**Interfaces:**
- Consumes: 无(纯函数,输入 `Uint8Array | number[]` 频谱数据)。
- Produces: `export interface BandEnergies { subBass: number; bass: number; lowMid: number; mid: number; highMid: number; presence: number; air: number; energy: number }` 与 `export function bandEnergiesFrom(data: Uint8Array | number[]): BandEnergies`,供 Task 2 的 `CoverParticleCloud.tsx` 导入使用。频段划分(假设 fftSize=2048→1024 bin、采样率 44100Hz):`subBass=[0,3)` `bass=[3,12)` `lowMid=[12,23)` `mid=[23,93)` `highMid=[93,186)` `presence=[186,279)` `air=[279,1024)`,`energy` = `[0, min(len,1024))` 整体平均。

- [ ] **Step 1: 在 `audio-energy.test.ts` 末尾追加失败的测试**

在文件末尾(现有 `smoothEnergy` describe 块之后)追加:

```ts
import { bandEnergiesFrom } from './audio-energy'

describe('bandEnergiesFrom', () => {
  it('空数据全部返回 0', () => {
    expect(bandEnergiesFrom([])).toEqual({
      subBass: 0,
      bass: 0,
      lowMid: 0,
      mid: 0,
      highMid: 0,
      presence: 0,
      air: 0,
      energy: 0
    })
  })

  it('单一频段拉满时只有该频段与 energy 受影响', () => {
    const data = new Uint8Array(1024)
    data.fill(255, 23, 93) // mid 频段范围 [23,93)
    const bands = bandEnergiesFrom(data)
    expect(bands.mid).toBe(1)
    expect(bands.subBass).toBe(0)
    expect(bands.bass).toBe(0)
    expect(bands.lowMid).toBe(0)
    expect(bands.highMid).toBe(0)
    expect(bands.presence).toBe(0)
    expect(bands.air).toBe(0)
    expect(bands.energy).toBeCloseTo((93 - 23) / 1024, 5)
  })

  it('全频谱拉满时七段与 energy 均为 1', () => {
    const data = new Uint8Array(1024).fill(255)
    const bands = bandEnergiesFrom(data)
    expect(bands.subBass).toBe(1)
    expect(bands.bass).toBe(1)
    expect(bands.lowMid).toBe(1)
    expect(bands.mid).toBe(1)
    expect(bands.highMid).toBe(1)
    expect(bands.presence).toBe(1)
    expect(bands.air).toBe(1)
    expect(bands.energy).toBe(1)
  })

  it('数据长度不足某频段范围时该频段返回 0', () => {
    const data = [200, 200]
    const bands = bandEnergiesFrom(data)
    expect(bands.mid).toBe(0)
    expect(bands.air).toBe(0)
  })
})
```

注意:文件顶部已有 `import { bassEnergyFrom, smoothEnergy } from './audio-energy'`,把新增的 `import { bandEnergiesFrom } from './audio-energy'` 合并进同一行,不要写两条 `import ... from './audio-energy'`:

```ts
import { describe, it, expect } from 'vitest'
import { bassEnergyFrom, smoothEnergy, bandEnergiesFrom } from './audio-energy'
```

（删除上面追加的独立 `import` 行,改成合并到顶部这一行。）

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/lib/audio-energy.test.ts`
Expected: FAIL,报错信息含 `bandEnergiesFrom is not defined` 或 `does not provide an export named 'bandEnergiesFrom'`。

- [ ] **Step 3: 实现 `bandEnergiesFrom`**

`src/lib/audio-energy.ts` 当前第 1 行的文档注释提到"取法与 CoverParticleCloud 一致",Task 2 之后不再成立,一并修正。把整个文件替换为:

```ts
/** 从频谱数据取低频段平均能量（0–1）。取前 16 个 bin。 */
export function bassEnergyFrom(data: Uint8Array | number[]): number {
  if (!data.length) return 0
  const n = Math.min(16, data.length)
  let sum = 0
  for (let i = 0; i < n; i++) sum += data[i]
  return sum / n / 255
}

/** 取指定频段原始值数组（归一化到 0–1），用于波形类效果。 */
export function spectrumSlice(data: Uint8Array | number[], start: number, count: number): Float32Array {
  const result = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    const idx = start + i
    result[i] = idx < data.length ? data[idx] / 255 : 0
  }
  return result
}

/** 指数平滑：上升快（有节拍感）、下降慢（不抖动）。 */
export function smoothEnergy(prev: number, next: number): number {
  const k = next > prev ? 0.35 : 0.08
  return prev + (next - prev) * k
}

/** 七段频谱能量（0–1），供逐粒子径向音频响应使用。 */
export interface BandEnergies {
  subBass: number
  bass: number
  lowMid: number
  mid: number
  highMid: number
  presence: number
  air: number
  energy: number
}

/** 各频段的 bin 范围（假设 fftSize=2048 → 1024 bin，采样率 44100Hz 时近似覆盖 20Hz~20kHz）。 */
const BAND_RANGES: Record<Exclude<keyof BandEnergies, 'energy'>, [number, number]> = {
  subBass: [0, 3],
  bass: [3, 12],
  lowMid: [12, 23],
  mid: [23, 93],
  highMid: [93, 186],
  presence: [186, 279],
  air: [279, 1024]
}

function averageRange(data: Uint8Array | number[], start: number, end: number): number {
  const len = data.length
  const from = Math.min(start, len)
  const to = Math.min(end, len)
  if (to <= from) return 0
  let sum = 0
  for (let i = from; i < to; i++) sum += data[i]
  return sum / (to - from) / 255
}

/** 把频谱数据切成 7 段能量 + 整体能量，供 CoverParticleCloud 的逐粒子径向弹跳使用。 */
export function bandEnergiesFrom(data: Uint8Array | number[]): BandEnergies {
  return {
    subBass: averageRange(data, ...BAND_RANGES.subBass),
    bass: averageRange(data, ...BAND_RANGES.bass),
    lowMid: averageRange(data, ...BAND_RANGES.lowMid),
    mid: averageRange(data, ...BAND_RANGES.mid),
    highMid: averageRange(data, ...BAND_RANGES.highMid),
    presence: averageRange(data, ...BAND_RANGES.presence),
    air: averageRange(data, ...BAND_RANGES.air),
    energy: averageRange(data, 0, Math.min(data.length, 1024))
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/lib/audio-energy.test.ts`
Expected: PASS,全部用例(含原有 `bassEnergyFrom`/`smoothEnergy`)通过。

- [ ] **Step 5: 全量验证**

Run: `npm run typecheck && npm test`
Expected: 两者均通过。

- [ ] **Step 6: Commit**

```bash
git add src/lib/audio-energy.ts src/lib/audio-energy.test.ts
git commit -m "$(cat <<'EOF'
feat: 新增七段频谱能量提取 bandEnergiesFrom

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `CoverParticleCloud` 核心重写(shader、密集网格、涟漪、相机接管)

**Files:**
- Modify: `src/components/Visualizer/CoverParticleCloud.tsx`(整体重写)

**Interfaces:**
- Consumes: Task 1 的 `bandEnergiesFrom(data): BandEnergies`(`src/lib/audio-energy.ts`);`useVisualStore(s => s.performanceMode)`;`usePlayerStore.getState()._engine().getFrequencyData()`;`api.url(path, params)`(`src/lib/api.ts`)。
- Produces: `export function CoverParticleCloud({ coverUrl }: { coverUrl?: string })`,组件内部通过 `useFrame` 直接设置 `state.camera.position`/`state.camera.lookAt`,接管相机(供 Task 3 的 `CinemaCamera` 短路判断依赖此行为)。

- [ ] **Step 1: 整体替换 `CoverParticleCloud.tsx`**

用以下内容整体覆盖 `src/components/Visualizer/CoverParticleCloud.tsx`:

```tsx
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

const GRID_SIZE_BY_MODE: Record<PerformanceMode, number> = {
  eco: 96,
  balanced: 130,
  high: 160,
  ultra: 190
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
```

- [ ] **Step 2: 验证**

Run: `npm run typecheck && npm test`
Expected: 两者均通过(无新增测试,回归不破;`npm test` 覆盖 Task 1 的 `bandEnergiesFrom` 单测)。

- [ ] **Step 3: Commit**

```bash
git add src/components/Visualizer/CoverParticleCloud.tsx
git commit -m "$(cat <<'EOF'
feat: 封面粒子云改用 shader 驱动的密集网格粒子墙

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `CinemaCamera` 让位封面粒子云 + 全量人工核验

**Files:**
- Modify: `src/components/Visualizer/CinemaCamera.tsx`

**Interfaces:**
- Consumes: `useSettingsStore.getState().lyrics3dEffect`(`src/stores/settings.ts`);Task 2 中 `CoverParticleCloud` 已自行接管相机的行为。
- Produces: 无对外接口变化(`CinemaCamera` 组件签名不变,仍是 `export function CinemaCamera()`)。

- [ ] **Step 1: 修改 `CinemaCamera.tsx`**

把整个文件内容替换为:

```tsx
import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useVisualStore } from '../../stores/visual'
import { useSettingsStore } from '../../stores/settings'

// 影院相机：缓慢环绕 + 可选轻微抖动（cinema/cinemaShake）。
// 封面粒子云（cover-cloud）改由自己控制固定机位 + 摇晃，这里让位，不与其抢相机。
export function CinemaCamera() {
  const { camera } = useThree()
  const t = useRef(0)

  useFrame((_, delta) => {
    if (useSettingsStore.getState().lyrics3dEffect === 'cover-cloud') return

    const fx = useVisualStore.getState().fx
    t.current += delta
    const cinema = fx.cinema !== false
    const radius = 14
    if (cinema) {
      const angle = t.current * 0.06
      camera.position.x = Math.sin(angle) * radius
      camera.position.z = Math.cos(angle) * radius
      const shake = (Number(fx.cinemaShake) || 0) * 0.3
      camera.position.y = Math.sin(t.current * 1.7) * shake
    } else {
      camera.position.set(0, 0, radius)
    }
    camera.lookAt(0, 0, 0)
  })

  return null
}
```

- [ ] **Step 2: 验证**

Run: `npm run typecheck && npm test`
Expected: 两者均通过。

- [ ] **Step 3: 人工核验(整个计划的最终验证)**

Run: `npm run dev`,进入歌词面板切到 3D 模式 → 封面粒子云,核对:

1. 深色专辑封面(找一张黑底封面测试)轮廓完整可辨,不再有大片空洞。
2. 播放音乐时能看到:中心区域随低频明显朝镜头弹跳、外圈随高频轻微响应,层次分明(不再是整体统一转/缩放)。
3. 鼓点明显的段落能看到环形涟漪从随机点扩散,强鼓点时涟漪经过的粒子有短暂飞散再回落。
4. 粒子墙叠加辉光,律动时有发光感。
5. 相机固定机位、只做轻微摇晃,不再整圈自转,封面图案任何时候都能看清。
6. 切歌时(尤其连续快速切换)无明显掉帧,新封面正确覆盖旧封面残留(无花屏/竞态残影)。
7. 打开设置切换性能档位(eco/balanced/high/ultra),粒子数量/密度随之变化,eco/balanced 档律动节奏略"跳帧"(节流生效)、high/ultra 档流畅。
8. 切换到另外两个 3D 效果(3D 频谱环/音箱沙粒),相机恢复环绕运镜且无跳变;再切回封面粒子云,相机重新固定且无异常。
9. 长时间播放并连续切多首歌后,内存与 GPU 占用无持续上涨(Chrome DevTools/Electron 任务管理器观察,确认 geometry 与分帧重建的 idle callback 均被正确清理)。

- [ ] **Step 4: Commit**

```bash
git add src/components/Visualizer/CinemaCamera.tsx
git commit -m "$(cat <<'EOF'
feat: 3D 相机在封面粒子云模式下让位给固定机位

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```
