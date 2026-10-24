import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { useVisualStore } from '../../stores/visual'
import { useSettingsStore } from '../../stores/settings'
import { usePlayerStore } from '../../stores/player'
import { api } from '../../lib/api'
import { bandEnergiesFrom, type BandEnergies } from '../../lib/audio-energy'
import { createParticleRippleBeatDetector, type ParticleRippleBeat } from '../../lib/particle-ripple-beat'
import { createParticleMusicDrive } from '../../lib/particle-music-drive'
import { frameBlend } from '../../lib/frame-blend'
import { buildEdgeDepthData } from '../../lib/cover-edge'
import { getDotSpriteTexture } from '../../lib/dot-texture'
import type { PerformanceMode } from '../../types/domain'
import { sizedImage, CANVAS_COVER_PX } from '../../lib/image-size'

/**
 * 封面粒子云(SILK):移植自原版 Mineradio-MacOS 的 preset 0 丝绸效果。
 * 与旧实现(烘焙颜色属性 + 径向分频弹跳)的关键差异:
 * - 颜色在 shader 里直接采样封面纹理,切歌时新旧封面 520ms 交叉渐变;
 * - 位移 = 三层 simplex 噪声场(bass 呼吸/mid 丝绸波/treble 微闪),整体像布料起伏;
 * - 轻鼓从分散落点柔和荡漾,少数显著重鼓从中心扩散,叠加位移有界;
 *   每拍一道,现有涟漪自然消退,不会被后续鼓点替换;
 * - 封面经 box blur+Sobel 生成边缘/深度纹理(cover-edge.ts),边缘粒子增亮放大、
 *   背景按前景 mask 压暗,轮廓更立体;
 * - 片元用柔和点精灵纹理,亮粒子加暗描边/暗粒子加亮描边(可读性),
 *   自发光在片元内完成,无独立辉光 pass/后期管线;
 * - 鼠标悬停把附近粒子朝镜头推起。
 * 相机仍由本组件接管(固定机位 + 轻摇晃),CinemaCamera 让位。
 */

const PLANE_SIZE = 4.8
const FOV = 45
const RIPPLE_MAX = 12
const COVER_TEX_SIZE = 384
const EDGE_TEX_SIZE = 256
const COLOR_MIX_MS = 520
const AUDIO_SAMPLE_INTERVAL = 1 / 30

function smoothAudioEnergy(previous: number, target: number, delta: number): number {
  return previous + (target - previous) * frameBlend(target > previous ? 0.35 : 0.08, delta)
}

// 网格每边粒子数按性能档取原版的档位上限(原版默认档 118)
const GRID_CAP_BY_MODE: Record<PerformanceMode, number> = {
  eco: 88,
  balanced: 118,
  high: 148,
  ultra: 183
}

const particleVertexShader = /* glsl */ `
  uniform float uTime, uBass, uMid, uTreble, uBeat, uEnergy, uDrive, uRippleGain;
  uniform float uIntensity, uPointScale, uColorBoost, uBgFade, uUserBright;
  uniform float uHasCover, uHasDepth, uEdgeEnabled;
  uniform float uMouseActive, uPixel, uColorMixT;
  uniform sampler2D uCoverTex, uPrevCoverTex, uEdgeTex, uRippleTex;
  uniform int uRippleCount;
  uniform vec2 uMouseXY;

  attribute float aRand;

  varying vec3 vColor;
  varying float vBright, vRipple, vEdgeBoost, vSourceLum;

  // ---- simplex noise (ashima) ----
  vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
  vec4 mod289v(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
  vec4 perm(vec4 x){return mod289v(((x*34.0)+1.0)*x);}
  float snoise(vec3 v){
    const vec2 C=vec2(1.0/6.0,1.0/3.0);
    const vec4 D=vec4(0.0,0.5,1.0,2.0);
    vec3 i=floor(v+dot(v,C.yyy));
    vec3 x0=v-i+dot(i,C.xxx);
    vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g;
    vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
    vec3 x1=x0-i1+C.xxx;
    vec3 x2=x0-i2+C.yyy;
    vec3 x3=x0-D.yyy;
    i=mod289(i);
    vec4 p=perm(perm(perm(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
    float n_=0.142857142857;
    vec3 ns=n_*D.wyz-D.xzx;
    vec4 j=p-49.0*floor(p*ns.z*ns.z);
    vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
    vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy;
    vec4 h=1.0-abs(x)-abs(y);
    vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
    vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0;
    vec4 sh=-step(h,vec4(0.0));
    vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
    vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
    vec4 norm=inversesqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
    p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
    vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);
    m=m*m;
    return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
  }

  vec2 safeCoverUv(vec2 p) {
    return clamp(p, vec2(0.0012), vec2(0.9988));
  }

  // 环形亮度与位移分开：小鼓点也能看清波前，形变仍保持轻柔、有界。
  float rippleSumAt(vec2 p, out float rippleLight, out vec2 rippleDrift) {
    float sum = 0.0; float lightSum = 0.0;
    vec2 driftSum = vec2(0.0);
    for (int ri = 0; ri < ${RIPPLE_MAX}; ri++) {
      if (ri >= uRippleCount) break;
      float vCoord = (float(ri) + 0.5) / ${RIPPLE_MAX}.0;
      vec4 rd = texture2D(uRippleTex, vec2(0.5, vCoord));
      float age = rd.z; float str = rd.w;
      float life = 1.15 + str * 0.85;
      if (str < 0.005 || age < 0.0 || age > life) continue;
      float dist = length(p - rd.xy);
      float fadeIn = smoothstep(0.0, 0.14, age);
      float fadeOut = 1.0 - smoothstep(life * 0.35, life, age);
      float accent = smoothstep(0.25, 0.45, str);
      float waveR = age * (1.45 + str * 1.1);
      float ringW = mix(0.12, 0.20, accent) + age * 0.08;
      float ring = exp(-pow((dist - waveR) / ringW, 2.0));
      float profile = ring * fadeIn * fadeOut * exp(-age * 0.4);
      float local = profile * str * (1.8 + accent * 1.2);
      sum += local;
      driftSum += (p - rd.xy) / max(dist, 0.001) * local;
      lightSum += profile * sqrt(str) * 1.8;
    }
    rippleLight = 1.0 - exp(-lightSum * uRippleGain);
    rippleDrift = driftSum / (1.0 + sum / 0.5) * 0.22 * uRippleGain;
    return sum / (1.0 + sum / 0.5) * uRippleGain;
  }

  void main() {
    float t = uTime;
    vec2 sampleUv = safeCoverUv(uv);

    // 切歌颜色渐变:新旧封面纹理插值
    vec3 newCol = texture2D(uCoverTex, sampleUv).rgb;
    vec3 prevCol = texture2D(uPrevCoverTex, sampleUv).rgb;
    vec3 coverColor = mix(prevCol, newCol, clamp(uColorMixT, 0.0, 1.0));
    vec4 edge = texture2D(uEdgeTex, sampleUv);
    float edgeVal = edge.g;
    float fgMask  = edge.b;

    vec3 defaultColor = mix(
      vec3(0.36, 0.28, 0.72),
      mix(vec3(0.85, 0.55, 0.95), vec3(0.45, 0.78, 0.95), uv.x),
      uv.y
    );
    vColor = mix(defaultColor, coverColor, uHasCover);

    // 律动强度倍数(设置滑块默认 1 → 原版默认 uIntensity 0.85 → K≈1.36)
    float K = uIntensity * 1.6;

    vec3 pos = position;
    float rippleLight = 0.0;
    vec2 rippleDrift;
    float rippleZ = rippleSumAt(pos.xy, rippleLight, rippleDrift);

    // 丝绸噪声场:mid 双八度波浪(带慢变空间 mask)+ treble 高频微闪 + bass 低频呼吸
    float midN = snoise(vec3(pos.x*1.4, pos.y*1.4, t*0.55)) * 0.6
               + snoise(vec3(pos.x*2.8+5.0, pos.y*2.8-3.0, t*0.85)) * 0.4;
    float midMask = 0.55 + 0.45 * snoise(vec3(pos.x*0.4, pos.y*0.4, t*0.18));
    float midDisp = midN * uMid * 0.55 * midMask * K * (1.0 + uDrive * 0.65);

    float trebleJ = snoise(vec3(pos.x*6.5, pos.y*6.5, t*3.5 + aRand*4.0)) * uTreble * 0.18 * K;
    float bassBreath = snoise(vec3(pos.x*0.35, pos.y*0.35, t*0.4)) * uBass * 0.42 * K;

    pos.xy += rippleDrift;
    // 段落能量带来连贯的舒展，不依赖每次鼓点都升级为重浪。
    float phraseFlow = sin(pos.x * 0.9 + pos.y * 0.55 - t * 1.7)
                     * sin(pos.y * 0.65 - t * 0.8) * uDrive * 0.15 * K;
    pos.z = rippleZ * 1.30 + midDisp + trebleJ + bassBreath + phraseFlow;

    // 鼠标悬停:附近粒子朝镜头推起
    if (uMouseActive > 0.5) {
      float md = length(pos.xy - uMouseXY);
      if (md < 1.0) {
        float push = (1.0 - md) * (1.0 - md);
        pos.z += push * 0.55;
      }
    }

    // 边缘增亮与可读性:近黑粒子不提亮(维持画面暗部)
    float edgeBoost = uEdgeEnabled * edgeVal;
    vSourceLum = dot(max(vColor, vec3(0.0)), vec3(0.299, 0.587, 0.114));
    float blackParticleGuard = 1.0 - smoothstep(0.025, 0.115, vSourceLum);
    vEdgeBoost = edgeBoost * (1.0 - blackParticleGuard);
    vColor = pow(max(vColor, vec3(0.0)), vec3(1.0 / max(0.35, uColorBoost)));
    float edgeColorMix = edgeBoost * 0.50 * (1.0 - blackParticleGuard);
    vColor = mix(vColor, vColor + vec3(0.20), edgeColorMix);

    vBright = 0.82 + uDrive * 0.15 + rippleLight * 0.85 + uBass * 0.10 + edgeBoost * 0.30 + uEnergy * 0.05;
    // 背景压暗:前景 mask 之外按 uBgFade 变暗,突出封面主体
    if (uHasDepth > 0.5) {
      vBright *= mix(1.0, 0.55, uBgFade * (1.0 - fgMask));
    }
    vBright *= uUserBright;
    vRipple = clamp(rippleLight * 1.5, 0.0, 1.0);

    vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
    float depthSize = 36.0 / max(0.5, -mvPos.z);
    float audioBoost = 1.0 + rippleLight * 0.7 + edgeBoost * 0.55 + uBeat * 0.30;
    float sz = clamp(depthSize * audioBoost, 1.05, 4.95);
    gl_PointSize = sz * uPixel * uPointScale;
    gl_Position = projectionMatrix * mvPos;
  }
`

const particleFragmentShader = /* glsl */ `
  uniform sampler2D uDotTex;
  uniform float uBloomStrength, uThemeOpacity;

  varying vec3 vColor;
  varying float vBright, vRipple, vEdgeBoost, vSourceLum;

  void main() {
    vec4 tex = texture2D(uDotTex, gl_PointCoord);
    if (tex.a < 0.02) discard;
    vec3 col = vColor * vBright;
    col = mix(col, col * 1.3 + vec3(0.05), vEdgeBoost * 0.35);
    col = mix(col, col * 1.2, vRipple * 0.4);

    // 可读性描边:亮粒子加暗环、暗粒子加亮环(近黑源色除外),封面细节不糊
    float keepBlack = 1.0 - smoothstep(0.025, 0.115, vSourceLum);
    float nonBlack = 1.0 - keepBlack;
    float dotDist = length(gl_PointCoord - vec2(0.5)) * 2.0;
    float readableRim = smoothstep(0.44, 0.94, dotDist) * (1.0 - smoothstep(0.94, 1.08, dotDist)) * tex.a;
    float outLum = dot(col, vec3(0.299, 0.587, 0.114));
    float lightParticle = smoothstep(0.50, 0.82, outLum) * nonBlack;
    float darkParticle = (1.0 - smoothstep(0.20, 0.50, outLum)) * nonBlack;
    col = mix(col, vec3(0.0), readableRim * lightParticle * 0.38);
    col = mix(col, vec3(1.0), readableRim * darkParticle * 0.20);
    col = clamp(col, vec3(0.0), vec3(1.6));

    // 自发光在片元内完成(原版为省 GPU 移除了独立辉光 pass)
    float bloomContrib = vBright * vBright * uBloomStrength * 0.04;
    col += col * bloomContrib;
    gl_FragColor = vec4(col, tex.a * uThemeOpacity);
  }
`

/** N×N 粒子铺满 PLANE_SIZE 的 XY 平面,颜色靠 uv 采样封面纹理,无烘焙色属性 */
function buildGeometry(gridSize: number): THREE.BufferGeometry {
  const count = gridSize * gridSize
  const positions = new Float32Array(count * 3)
  const uvs = new Float32Array(count * 2)
  const randoms = new Float32Array(count)
  let i = 0
  for (let gy = 0; gy < gridSize; gy++) {
    for (let gx = 0; gx < gridSize; gx++) {
      positions[i * 3] = (gx / (gridSize - 1) - 0.5) * PLANE_SIZE
      positions[i * 3 + 1] = (gy / (gridSize - 1) - 0.5) * PLANE_SIZE
      positions[i * 3 + 2] = 0
      uvs[i * 2] = (gx + 0.5) / gridSize
      uvs[i * 2 + 1] = (gy + 0.5) / gridSize
      randoms[i] = Math.random()
      i++
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geometry.setAttribute('aRand', new THREE.BufferAttribute(randoms, 1))
  return geometry
}

function makeCoverCanvas(): HTMLCanvasElement {
  const cv = document.createElement('canvas')
  cv.width = cv.height = COVER_TEX_SIZE
  const ctx = cv.getContext('2d')!
  ctx.fillStyle = '#1c1c28'
  ctx.fillRect(0, 0, COVER_TEX_SIZE, COVER_TEX_SIZE)
  return cv
}

interface RippleState {
  x: number
  y: number
  start: number
  str: number
  speed: number
}

interface CoverParticleCloudProps {
  coverUrl?: string
  lightBackground?: boolean
}

export function CoverParticleCloud({ coverUrl, lightBackground = false }: CoverParticleCloudProps) {
  const performanceMode = useVisualStore((s) => s.performanceMode)
  // 粒子数量倍率作用于总粒子数(gridSize²),故对 gridSize 开平方;变化时重建 geometry
  const countScale = useSettingsStore((s) => s.lyrics3d.particleCount)
  const gridSize =
    THREE.MathUtils.clamp(
      Math.round(GRID_CAP_BY_MODE[performanceMode] * Math.sqrt(countScale)),
      48,
      216
    ) | 1 // 奇数网格让中心正好有一颗粒子(原版约定)
  const throttle = performanceMode === 'eco' || performanceMode === 'balanced'

  const swayGroupRef = useRef<THREE.Group>(null)
  const mousePlaneRef = useRef<THREE.Mesh>(null)
  const mouseLocal = useRef(new THREE.Vector3())

  const ripplesRef = useRef<RippleState[]>(
    Array.from({ length: RIPPLE_MAX }, () => ({ x: 0, y: 0, start: -100, str: 0, speed: 1 }))
  )
  const rippleBeatRef = useRef(createParticleRippleBeatDetector())
  const musicDriveRef = useRef(createParticleMusicDrive())
  const beatEnvRef = useRef(0)
  const colorMixStartRef = useRef(-1)
  const sampleElapsedRef = useRef(0)
  const sampledBandsRef = useRef<BandEnergies | null>(null)
  const bassSmoothRef = useRef(0)
  const midSmoothRef = useRef(0)
  const trebleSmoothRef = useRef(0)
  const energySmoothRef = useRef(0)
  const audioGateRef = useRef(0)
  const activeRippleIndicesRef = useRef<number[]>([])

  const proxyUrl = coverUrl ? api.coverImage(sizedImage(coverUrl, CANVAS_COVER_PX)) : undefined

  const geometry = useMemo(() => buildGeometry(gridSize), [gridSize])
  useEffect(() => () => geometry.dispose(), [geometry])

  // 纹理集:封面/上一张封面(CanvasTexture,切歌时互换内容)、边缘/深度(DataTexture,
  // 避开 canvas putImageData 的低 alpha 预乘精度损失)、涟漪数据(1×12 float)、点精灵
  const textures = useMemo(() => {
    const coverTex = new THREE.CanvasTexture(makeCoverCanvas())
    coverTex.minFilter = THREE.LinearFilter
    coverTex.magFilter = THREE.LinearFilter
    coverTex.wrapS = coverTex.wrapT = THREE.ClampToEdgeWrapping
    const prevCoverTex = new THREE.CanvasTexture(makeCoverCanvas())
    prevCoverTex.minFilter = THREE.LinearFilter
    prevCoverTex.magFilter = THREE.LinearFilter
    prevCoverTex.wrapS = prevCoverTex.wrapT = THREE.ClampToEdgeWrapping

    const edgeTex = new THREE.DataTexture(
      new Uint8Array(EDGE_TEX_SIZE * EDGE_TEX_SIZE * 4),
      EDGE_TEX_SIZE,
      EDGE_TEX_SIZE,
      THREE.RGBAFormat,
      THREE.UnsignedByteType
    )
    edgeTex.minFilter = THREE.LinearFilter
    edgeTex.magFilter = THREE.LinearFilter
    edgeTex.needsUpdate = true

    const rippleTex = new THREE.DataTexture(
      new Float32Array(RIPPLE_MAX * 4),
      1,
      RIPPLE_MAX,
      THREE.RGBAFormat,
      THREE.FloatType
    )
    rippleTex.minFilter = THREE.NearestFilter
    rippleTex.magFilter = THREE.NearestFilter
    rippleTex.needsUpdate = true

    const dotTex = getDotSpriteTexture()
    return { coverTex, prevCoverTex, edgeTex, rippleTex, dotTex }
  }, [])
  useEffect(
    () => () => {
      // dotTex 是模块级共享缓存,不随组件卸载 dispose
      textures.coverTex.dispose()
      textures.prevCoverTex.dispose()
      textures.edgeTex.dispose()
      textures.rippleTex.dispose()
    },
    [textures]
  )

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uBass: { value: 0 },
      uMid: { value: 0 },
      uTreble: { value: 0 },
      uBeat: { value: 0 },
      uDrive: { value: 0 },
      uRippleGain: { value: 1 },
      uEnergy: { value: 0 },
      uIntensity: { value: 0.85 },
      uPointScale: { value: 1 },
      uColorBoost: { value: 1.1 },
      uBgFade: { value: 0.2 },
      uUserBright: { value: 1 },
      uBloomStrength: { value: 0.62 },
      uThemeOpacity: { value: 1 },
      uHasCover: { value: 0 },
      uHasDepth: { value: 0 },
      uEdgeEnabled: { value: 1 },
      uMouseActive: { value: 0 },
      uMouseXY: { value: new THREE.Vector2(-999, -999) },
      uPixel: { value: 1 },
      uColorMixT: { value: 1 },
      uCoverTex: { value: textures.coverTex },
      uPrevCoverTex: { value: textures.prevCoverTex },
      uEdgeTex: { value: textures.edgeTex },
      uRippleTex: { value: textures.rippleTex },
      uRippleCount: { value: 0 },
      uDotTex: { value: textures.dotTex }
    }),
    [textures]
  )

  useEffect(() => {
    // 浅色舞台透出更多底色，封面保持原色，避免深色像素吞掉深色歌词。
    uniforms.uThemeOpacity.value = lightBackground ? 0.88 : 1
  }, [lightBackground, uniforms])

  // gl_PointSize 以物理像素计
  const dpr = useThree((s) => s.viewport.dpr)
  useEffect(() => {
    uniforms.uPixel.value = dpr
  }, [dpr, uniforms])

  // 全局相机 fov 是 60(其他 3D 效果共用),本效果接管期间改为更平的 45,卸载还原
  const camera = useThree((s) => s.camera)
  useEffect(() => {
    if (!(camera instanceof THREE.PerspectiveCamera)) return
    const prevFov = camera.fov
    camera.fov = FOV
    camera.updateProjectionMatrix()
    return () => {
      camera.fov = prevFov
      camera.updateProjectionMatrix()
    }
  }, [camera])

  // 封面加载:旧封面拷入 prev 纹理 → 新封面写入主纹理并起 520ms 交叉渐变,
  // 同时经 box blur+Sobel 重建边缘/深度纹理(行序翻转:DataTexture 不做 flipY)
  useEffect(() => {
    if (!proxyUrl) return
    let disposed = false
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      if (disposed) return
      const coverCanvas = textures.coverTex.image as HTMLCanvasElement
      const prevCanvas = textures.prevCoverTex.image as HTMLCanvasElement
      const prevCtx = prevCanvas.getContext('2d')
      const ctx = coverCanvas.getContext('2d')
      if (!ctx || !prevCtx) return
      prevCtx.drawImage(coverCanvas, 0, 0)
      try {
        ctx.drawImage(img, 0, 0, COVER_TEX_SIZE, COVER_TEX_SIZE)
      } catch {
        return
      }
      textures.coverTex.needsUpdate = true
      textures.prevCoverTex.needsUpdate = true
      // 首张封面直接显示,后续切歌走交叉渐变
      colorMixStartRef.current = uniforms.uHasCover.value > 0.5 ? performance.now() : -1
      uniforms.uColorMixT.value = uniforms.uHasCover.value > 0.5 ? 0 : 1
      uniforms.uHasCover.value = 1

      try {
        const sample = document.createElement('canvas')
        sample.width = sample.height = EDGE_TEX_SIZE
        const sctx = sample.getContext('2d', { willReadFrequently: true })
        if (sctx) {
          sctx.drawImage(img, 0, 0, EDGE_TEX_SIZE, EDGE_TEX_SIZE)
          const src = sctx.getImageData(0, 0, EDGE_TEX_SIZE, EDGE_TEX_SIZE).data
          const data = buildEdgeDepthData(src, EDGE_TEX_SIZE, EDGE_TEX_SIZE)
          const dst = textures.edgeTex.image.data as Uint8Array
          const rowBytes = EDGE_TEX_SIZE * 4
          for (let y = 0; y < EDGE_TEX_SIZE; y++) {
            const srcOff = (EDGE_TEX_SIZE - 1 - y) * rowBytes
            dst.set(data.subarray(srcOff, srcOff + rowBytes), y * rowBytes)
          }
          textures.edgeTex.needsUpdate = true
          uniforms.uHasDepth.value = 1
        }
      } catch {
        // 跨域污染等无法读取像素:保留上一张的边缘纹理
      }
    }
    img.src = proxyUrl
    return () => {
      disposed = true
      img.onload = null
      img.src = ''
    }
  }, [proxyUrl, textures, uniforms])

  const onPointerMove = (e: ThreeEvent<PointerEvent>) => {
    const plane = mousePlaneRef.current
    if (!plane) return
    plane.worldToLocal(mouseLocal.current.copy(e.point))
    uniforms.uMouseXY.value.set(mouseLocal.current.x, mouseLocal.current.y)
    uniforms.uMouseActive.value = 1
  }
  const onPointerOut = () => {
    uniforms.uMouseActive.value = 0
    uniforms.uMouseXY.value.set(-999, -999)
  }

  useFrame((state, delta) => {
    // 固定机位正对粒子墙,相机由本组件接管
    const dist = (PLANE_SIZE / 2 / Math.tan(THREE.MathUtils.degToRad(FOV) / 2)) * 1.12
    state.camera.position.set(0, 0, dist)
    state.camera.lookAt(0, 0, 0)

    const t = state.clock.getElapsedTime()
    uniforms.uTime.value = t

    // 正面小幅摇晃:非整圈旋转,保持封面正对镜头可辨识
    if (swayGroupRef.current) {
      swayGroupRef.current.rotation.x = Math.sin(t * 0.5) * 0.04
      swayGroupRef.current.rotation.y = Math.cos(t * 0.4) * 0.05
      swayGroupRef.current.rotation.z = Math.sin(t * 0.3) * 0.015
    }

    // 切歌交叉渐变推进
    if (colorMixStartRef.current >= 0) {
      const p = (performance.now() - colorMixStartRef.current) / COLOR_MIX_MS
      uniforms.uColorMixT.value = THREE.MathUtils.smoothstep(p, 0, 1)
      if (p >= 1) colorMixStartRef.current = -1
    }

    const params = useSettingsStore.getState().lyrics3d
    // 均衡/节能档只限制频谱采样；鼓点只在新样本上检测，衰减与涟漪仍逐帧推进。
    let hit: ParticleRippleBeat | null = null
    sampleElapsedRef.current += delta
    if (!throttle || !sampledBandsRef.current || sampleElapsedRef.current + 1e-9 >= AUDIO_SAMPLE_INTERVAL) {
      const frequency = usePlayerStore.getState()._frequencyData()
      const bands = bandEnergiesFrom(frequency)
      sampledBandsRef.current = bands
      if (frequency.length) hit = rippleBeatRef.current.update(
        bands.subBass + bands.bass, t, params.rippleSensitivity,
        bands.lowMid * 0.2 + bands.mid * 0.35 + bands.highMid * 0.3 + bands.presence * 0.15
      )
      else rippleBeatRef.current.reset()
      const samplePeriods = Math.floor((sampleElapsedRef.current + 1e-9) / AUDIO_SAMPLE_INTERVAL)
      sampleElapsedRef.current = Math.max(0, sampleElapsedRef.current - samplePeriods * AUDIO_SAMPLE_INTERVAL)
    }

    uniforms.uPointScale.value = params.particleSize
    uniforms.uUserBright.value = params.particleBrightness
    uniforms.uBloomStrength.value = 0.62 * params.glowStrength
    uniforms.uIntensity.value = 0.85 * params.motionIntensity

    const bands = sampledBandsRef.current!
    // 静音→播放瞬间频谱是阶跃(gain 淡入包络不影响 analyser 读数),原始值直接
    // 驱动位移场会导致整面粒子在起播那一刻大幅度抖动,故做指数平滑(升快降慢)
    const rawBassSum = bands.subBass + bands.bass
    const gateTarget = bands.energy > 0.012 ? 1 : 0
    const gateRate = gateTarget > audioGateRef.current ? 4.2 : 2.2
    audioGateRef.current += (gateTarget - audioGateRef.current) * (-Math.expm1(-delta * gateRate))
    const audioGate = audioGateRef.current
    const bassSum = rawBassSum * audioGate
    bassSmoothRef.current = smoothAudioEnergy(bassSmoothRef.current, bassSum * 0.5, delta)
    midSmoothRef.current = smoothAudioEnergy(midSmoothRef.current, (bands.lowMid + bands.mid) * 0.5 * audioGate, delta)
    trebleSmoothRef.current = smoothAudioEnergy(
      trebleSmoothRef.current,
      ((bands.highMid + bands.presence + bands.air) / 3) * audioGate,
      delta
    )
    energySmoothRef.current = smoothAudioEnergy(energySmoothRef.current, bands.energy * audioGate, delta)
    uniforms.uBass.value = bassSmoothRef.current
    uniforms.uMid.value = midSmoothRef.current
    uniforms.uTreble.value = trebleSmoothRef.current
    uniforms.uEnergy.value = energySmoothRef.current

    const drive = musicDriveRef.current.update(
      rawBassSum * 0.175 + (bands.lowMid + bands.mid + bands.highMid + bands.presence) * 0.1 + bands.energy * 0.25,
      t, hit !== null
    )
    uniforms.uDrive.value = drive

    // 先让已有波纹按各自年龄自然推进，再接纳新鼓点；不抢占、重置或排队补发。
    const ageScale = 0.55 / THREE.MathUtils.clamp(params.rippleDuration, 0.15, 2)
    const maxActive = params.rippleAmplitude <= 0 ? 0 : 6
    const gainTarget = THREE.MathUtils.clamp(params.rippleAmplitude, 0, 1) * 2
    uniforms.uRippleGain.value += (gainTarget - uniforms.uRippleGain.value) * -Math.expm1(-delta * 8)
    let liveCount = 0
    for (const ripple of ripplesRef.current) {
      if (maxActive === 0 || (t - ripple.start) * ageScale * ripple.speed >= 1.15 + ripple.str * 0.85) ripple.str = 0
      if (ripple.str > 0.005) liveCount++
    }
    // 数量允许时为少数重鼓留一个空位，避免轻鼓铺满后吞掉强拍。
    const admissionLimit = hit?.kind === 'soft' ? Math.max(1, maxActive - 1) : maxActive
    if (hit && maxActive > 0 && liveCount < admissionLimit) {
      const slot = ripplesRef.current.find(ripple => ripple.str <= 0.005)
      if (slot) {
        // 每一圈只在出生时选落点，后续保持不动；避免随机位置逐帧跳动。
        slot.x = slot.y = 0
        if (hit.kind === 'soft') {
          const angle = Math.random() * Math.PI * 2
          const radius = Math.sqrt(Math.random()) * PLANE_SIZE * 0.3
          slot.x = Math.cos(angle) * radius
          slot.y = Math.sin(angle) * radius
        }
        slot.start = t
        slot.str = hit.kind === 'soft' ? Math.min(0.24, hit.strength * (1 + drive * 0.7)) : hit.strength
        // 只影响新波纹；在途波纹的速度保持不变，密集段落有更多空位接住后续节奏。
        slot.speed = hit.kind === 'soft' ? 1 + Math.max(0, drive - 0.15) * 0.95 : 1
      }
    }

    // 涟漪推进：时长滑块统一缩放年龄，强度连续决定每圈的自然消退时长。
    const data = textures.rippleTex.image.data as unknown as Float32Array
    const activeIndices = activeRippleIndicesRef.current
    activeIndices.length = 0
    for (let i = 0; i < RIPPLE_MAX; i++) {
      const r = ripplesRef.current[i]
      if (r.str > 0.005) activeIndices.push(i)
    }
    // 数量由音乐驱动，用户调节只影响幅度；关闭时清空在途波纹。
    const active = activeIndices.length
    let beatTarget = 0
    for (let i = 0; i < active; i++) {
      const r = ripplesRef.current[activeIndices[i]]
      const age = (t - r.start) * ageScale * r.speed
      const life = 1.15 + r.str * 0.85
      beatTarget = Math.max(beatTarget, r.str * THREE.MathUtils.smoothstep(age, 0, 0.14)
        * (1 - THREE.MathUtils.smoothstep(age, life * 0.35, life)))
      // 紧凑写入活跃涟漪，shader 循环次数等于真实数量，不再因环形槽位下标升高而空跑。
      const dataOff = i * 4
      data[dataOff] = r.x
      data[dataOff + 1] = r.y
      data[dataOff + 2] = age
      data[dataOff + 3] = r.str
    }
    beatEnvRef.current += (beatTarget * 0.12 - beatEnvRef.current) * -Math.expm1(-delta * 8)
    uniforms.uBeat.value = beatEnvRef.current
    textures.rippleTex.needsUpdate = true
    uniforms.uRippleCount.value = active
  })

  return (
    <group ref={swayGroupRef}>
      <points geometry={geometry}>
        <shaderMaterial
          vertexShader={particleVertexShader}
          fragmentShader={particleFragmentShader}
          uniforms={uniforms}
          transparent
          depthWrite={false}
          depthTest={false}
        />
      </points>
      {/* 不可见的鼠标拾取面:与粒子同组同姿态,拾取坐标即粒子局部坐标 */}
      <mesh ref={mousePlaneRef} onPointerMove={onPointerMove} onPointerOut={onPointerOut}>
        <planeGeometry args={[PLANE_SIZE, PLANE_SIZE]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
      </mesh>
    </group>
  )
}
