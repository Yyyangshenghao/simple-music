import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { useVisualStore } from '../../stores/visual'
import { useSettingsStore } from '../../stores/settings'
import { usePlayerStore } from '../../stores/player'
import { api } from '../../lib/api'
import { bandEnergiesFrom } from '../../lib/audio-energy'
import { buildEdgeDepthData } from '../../lib/cover-edge'
import type { PerformanceMode } from '../../types/domain'

/**
 * 封面粒子云(SILK):移植自原版 Mineradio-MacOS 的 preset 0 丝绸效果。
 * 与旧实现(烘焙颜色属性 + 径向分频弹跳)的关键差异:
 * - 颜色在 shader 里直接采样封面纹理,切歌时新旧封面 520ms 交叉渐变;
 * - 位移 = 三层 simplex 噪声场(bass 呼吸/mid 丝绸波/treble 微闪),整体像布料起伏;
 * - 鼓点涟漪 = 中心隆起 + 扩散环,带淡入淡出包络,2s 生命周期,12 道并发,
 *   bass 上升沿在 3×3 九宫格随机爆 2-3 个点;
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
const RIPPLE_COOLDOWN = 0.32
const COLOR_MIX_MS = 520
const FRAME_INTERVAL_MS = 1000 / 30

// 网格每边粒子数按性能档取原版的档位上限(原版默认档 118)
const GRID_CAP_BY_MODE: Record<PerformanceMode, number> = {
  eco: 88,
  balanced: 118,
  high: 148,
  ultra: 183
}

// 涟漪爆点的 3×3 九宫格中心(原版 initRippleRegions)
const RIPPLE_REGIONS: Array<[number, number]> = []
for (let ry = 0; ry < 3; ry++) {
  for (let rx = 0; rx < 3; rx++) {
    RIPPLE_REGIONS.push([(rx / 2 - 0.5) * PLANE_SIZE * 0.72, (ry / 2 - 0.5) * PLANE_SIZE * 0.72])
  }
}

const particleVertexShader = /* glsl */ `
  uniform float uTime, uBass, uMid, uTreble, uBeat, uEnergy;
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

  // 涟漪场:每道 = 中心高斯隆起(随年龄变宽变矮) + 扩散环,fadeIn/fadeOut 包络
  float rippleSumAt(vec2 p, out float maxAmp) {
    float sum = 0.0; maxAmp = 0.0;
    for (int ri = 0; ri < ${RIPPLE_MAX}; ri++) {
      if (ri >= uRippleCount) break;
      float vCoord = (float(ri) + 0.5) / ${RIPPLE_MAX}.0;
      vec4 rd = texture2D(uRippleTex, vec2(0.5, vCoord));
      float age = rd.z; float str = rd.w;
      if (str < 0.005 || age < 0.0 || age > 2.0) continue;
      float dist = length(p - rd.xy);
      float lifeN = age / 2.0;
      float fadeIn  = smoothstep(0.0, 0.06, age);
      float fadeOut = 1.0 - smoothstep(0.7, 1.0, lifeN);
      float env = fadeIn * fadeOut;
      float bulgeW = 0.55 + age * 0.80;
      float bulge  = exp(-dist*dist / (2.0 * bulgeW * bulgeW)) * (1.0 - smoothstep(0.0, 0.55, lifeN));
      float waveR  = age * 2.10;
      float ringW  = 0.40 + age * 0.22;
      float ring   = exp(-pow((dist - waveR) / ringW, 2.0));
      float local  = (bulge * 2.4 + ring * 1.30) * env * str;
      sum += local;
      maxAmp = max(maxAmp, abs(local));
    }
    return sum;
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
    float maxRippleAmp = 0.0;
    float rippleZ = rippleSumAt(pos.xy, maxRippleAmp);

    // 丝绸噪声场:mid 双八度波浪(带慢变空间 mask)+ treble 高频微闪 + bass 低频呼吸
    float midN = snoise(vec3(pos.x*1.4, pos.y*1.4, t*0.55)) * 0.6
               + snoise(vec3(pos.x*2.8+5.0, pos.y*2.8-3.0, t*0.85)) * 0.4;
    float midMask = 0.55 + 0.45 * snoise(vec3(pos.x*0.4, pos.y*0.4, t*0.18));
    float midDisp = midN * uMid * 0.55 * midMask * K;

    float trebleJ = snoise(vec3(pos.x*6.5, pos.y*6.5, t*3.5 + aRand*4.0)) * uTreble * 0.18 * K;
    float bassBreath = snoise(vec3(pos.x*0.35, pos.y*0.35, t*0.4)) * uBass * 0.42 * K;

    pos.z = rippleZ * 1.30 + midDisp + trebleJ + bassBreath;

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

    vBright = 0.82 + maxRippleAmp * 0.55 + uBass * 0.10 + edgeBoost * 0.30 + uEnergy * 0.05;
    // 背景压暗:前景 mask 之外按 uBgFade 变暗,突出封面主体
    if (uHasDepth > 0.5) {
      vBright *= mix(1.0, 0.55, uBgFade * (1.0 - fgMask));
    }
    vBright *= uUserBright;
    vRipple = clamp(maxRippleAmp * 1.5, 0.0, 1.0);

    vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
    float depthSize = 36.0 / max(0.5, -mvPos.z);
    float audioBoost = 1.0 + maxRippleAmp * 0.7 + edgeBoost * 0.55 + uBeat * 0.30;
    float sz = clamp(depthSize * audioBoost, 1.05, 4.95);
    gl_PointSize = sz * uPixel * uPointScale;
    gl_Position = projectionMatrix * mvPos;
  }
`

const particleFragmentShader = /* glsl */ `
  uniform sampler2D uDotTex;
  uniform float uBloomStrength;

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
    gl_FragColor = vec4(col, tex.a);
  }
`

/** 柔和圆点精灵(干净圆点带衰减缘,无外圈 glow) */
function makeDotTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas')
  cv.width = cv.height = 64
  const ctx = cv.getContext('2d')!
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 31)
  g.addColorStop(0.0, 'rgba(255,255,255,0.96)')
  g.addColorStop(0.42, 'rgba(255,255,255,0.78)')
  g.addColorStop(0.72, 'rgba(255,255,255,0.22)')
  g.addColorStop(1.0, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 64, 64)
  const tex = new THREE.CanvasTexture(cv)
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  return tex
}

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
}

interface CoverParticleCloudProps {
  coverUrl?: string
}

export function CoverParticleCloud({ coverUrl }: CoverParticleCloudProps) {
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
    Array.from({ length: RIPPLE_MAX }, () => ({ x: 0, y: 0, start: -100, str: 0 }))
  )
  const rippleSlotRef = useRef(0)
  const bassAboveRef = useRef(false)
  const lastRippleAtRef = useRef(-10)
  const beatEnvRef = useRef(0)
  const colorMixStartRef = useRef(-1)
  const lastFrameTimeRef = useRef(0)

  const proxyUrl = coverUrl ? api.url('/proxy/cover', { url: coverUrl }) : undefined

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

    const dotTex = makeDotTexture()
    return { coverTex, prevCoverTex, edgeTex, rippleTex, dotTex }
  }, [])
  useEffect(
    () => () => {
      textures.coverTex.dispose()
      textures.prevCoverTex.dispose()
      textures.edgeTex.dispose()
      textures.rippleTex.dispose()
      textures.dotTex.dispose()
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
      uEnergy: { value: 0 },
      uIntensity: { value: 0.85 },
      uPointScale: { value: 1 },
      uColorBoost: { value: 1.1 },
      uBgFade: { value: 0.2 },
      uUserBright: { value: 1 },
      uBloomStrength: { value: 0.62 },
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

    // 仅 eco/balanced 档节流:跳过本帧的频段计算/节拍检测/涟漪推进
    if (throttle) {
      const nowMs = performance.now()
      if (nowMs - lastFrameTimeRef.current < FRAME_INTERVAL_MS) return
      lastFrameTimeRef.current = nowMs
    }

    const params = useSettingsStore.getState().lyrics3d
    uniforms.uPointScale.value = params.particleSize
    uniforms.uUserBright.value = params.particleBrightness
    uniforms.uBloomStrength.value = 0.62 * params.glowStrength
    uniforms.uIntensity.value = 0.85 * params.motionIntensity

    const engine = usePlayerStore.getState()._engine()
    const bands = bandEnergiesFrom(engine.getFrequencyData())
    const bassSum = bands.subBass + bands.bass
    uniforms.uBass.value = bassSum * 0.5
    uniforms.uMid.value = (bands.lowMid + bands.mid) * 0.5
    uniforms.uTreble.value = (bands.highMid + bands.presence + bands.air) / 3
    uniforms.uEnergy.value = bands.energy

    // 节拍包络:鼓点瞬间 1,随后指数衰减,驱动点径涨缩
    beatEnvRef.current = Math.max(0, beatEnvRef.current - delta * 3.5)
    uniforms.uBeat.value = beatEnvRef.current

    // bass 上升沿(带迟滞)触发涟漪:九宫格随机挑 2-3 个爆点。
    // 阈值随灵敏度线性下降:灵敏度 0.5 时为历史默认 0.38
    const beatThreshold = 0.58 - 0.4 * params.rippleSensitivity
    const isHit = bassSum > beatThreshold && !bassAboveRef.current
    bassAboveRef.current = bassSum > beatThreshold * 0.75
    if (isHit && t - lastRippleAtRef.current > RIPPLE_COOLDOWN) {
      lastRippleAtRef.current = t
      beatEnvRef.current = 1
      const burst = 2 + (Math.random() < 0.5 ? 0 : 1)
      const count = THREE.MathUtils.clamp(Math.round((params.rippleCount / 6) * burst), 1, 4)
      const used = new Set<number>()
      for (let k = 0; k < count; k++) {
        let idx = Math.floor(Math.random() * 9)
        for (let tries = 0; used.has(idx) && tries < 12; tries++) idx = Math.floor(Math.random() * 9)
        used.add(idx)
        const [rx, ry] = RIPPLE_REGIONS[idx]
        const slot = ripplesRef.current[rippleSlotRef.current]
        slot.x = rx + (Math.random() - 0.5) * 0.7
        slot.y = ry + (Math.random() - 0.5) * 0.7
        slot.start = t
        slot.str = 0.65 + uniforms.uBass.value * 1.4 + Math.random() * 0.25
        rippleSlotRef.current = (rippleSlotRef.current + 1) % RIPPLE_MAX
      }
    }

    // 涟漪推进:年龄写入数据纹理;时长滑块缩放年龄流速(默认 0.55 → 原版 2s 生命)
    const ageScale = 0.55 / THREE.MathUtils.clamp(params.rippleDuration, 0.15, 2)
    const data = textures.rippleTex.image.data as unknown as Float32Array
    let active = 0
    for (let i = 0; i < RIPPLE_MAX; i++) {
      const r = ripplesRef.current[i]
      const age = (t - r.start) * ageScale
      if (r.str > 0.005 && age > 2.0) r.str = 0
      if (r.str > 0.005) active = i + 1
      const off = i * 4
      data[off] = r.x
      data[off + 1] = r.y
      data[off + 2] = age
      data[off + 3] = r.str
    }
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
