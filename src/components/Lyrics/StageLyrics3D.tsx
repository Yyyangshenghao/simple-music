import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useLyricsStore } from '../../stores/lyrics'
import { usePlayerStore } from '../../stores/player'
import { useSettingsStore } from '../../stores/settings'
import { api } from '../../lib/api'
import { bandEnergiesFrom } from '../../lib/audio-energy'
import { getDotSpriteTexture } from '../../lib/dot-texture'
import { lyricPaletteFromCoverPixels, silverBlueLyricPalette, type LyricPalette } from '../../lib/lyric-palette'
import {
  makeLyricMask,
  makeReadabilityTexture,
  makeGlowTexture,
  getSunBloomTexture,
  invalidateLyricFontCache
} from './stage-lyric-textures'
import type { LyricLine as LyricLineData, WordLyricLine } from '../../types/domain'

/**
 * 3D 舞台歌词(移植自 Mineradio-MacOS 的 stageLyrics 系统):歌词以四层结构
 * 悬浮在 3D 场景中——太阳暖辉板(additive)+ 文字辉光板(additive)+ 黑白描边
 * 可读性板 + 文字 mask 板(KTV 进度扫光 shader),外加 132 颗环绕星点。
 * 切行时旧行淡出后飘、新行 0.52s 呼吸浮入;调色板从封面像素推导
 * (lyric-palette.ts),辉光/太阳随节拍与能量呼吸;翻译行是原版没有的补充。
 * 相对原版简化:去掉骷髅/书架/壁纸联动、镜头锁定布局滑杆、自定义配色与
 * "星河"点带(原版默认关闭的装饰),环绕星点由 lyrics3d.glowStrength 驱动。
 */

const WORLD_W = 6.1
const MASK_ASPECT = 384 / 2048
const WORLD_H = WORLD_W * MASK_ASPECT
const BEAT_THRESHOLD = 0.38
const BEAT_COOLDOWN = 0.18
const STAR_COUNT = 420
const SPARK_COUNT = 132

function lyricColor(css: string | undefined, fallback: string, minLum: number): THREE.Color {
  const c = new THREE.Color()
  try {
    c.setStyle(css || fallback)
  } catch {
    c.set(fallback)
  }
  const lum = c.r * 0.299 + c.g * 0.587 + c.b * 0.114
  if (lum < minLum) {
    const lift = minLum - lum
    c.r = Math.min(1, c.r + lift)
    c.g = Math.min(1, c.g + lift)
    c.b = Math.min(1, c.b + lift)
  }
  return c
}

/** KTV 进度扫光 shader:uProgress 在文字区 [uTextMin,uTextMax] 内从左向右点亮 */
function makeTextMaterial(mask: ReturnType<typeof makeLyricMask>, pal: LyricPalette, hasKaraoke: boolean) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: mask.texture },
      uProgress: { value: 0 },
      uTextMin: { value: mask.textMin },
      uTextMax: { value: mask.textMax },
      uOpacity: { value: 0 },
      uBaseColor: { value: lyricColor(pal.primary, '#d6f8ff', 0.38) },
      uHiColor: { value: lyricColor(pal.highlight || pal.primary, '#fff0b8', 0.48) },
      uGlowColor: { value: lyricColor(pal.glowColor || pal.secondary, '#9cffdf', 0.36) },
      uSolarColor: { value: lyricColor(pal.highlight || pal.secondary || pal.primary, '#fff0b8', 0.5) },
      uFeather: { value: hasKaraoke ? 0.03 : 0.055 },
      uSolar: { value: 0 }
    },
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform float uProgress, uTextMin, uTextMax, uOpacity, uFeather, uSolar;
      uniform vec3 uBaseColor, uHiColor, uGlowColor, uSolarColor;
      varying vec2 vUv;
      void main(){
        vec2 uv = gl_FrontFacing ? vUv : vec2(1.0 - vUv.x, vUv.y);
        float mask = texture2D(uMap, uv).a;
        if (mask < 0.01) discard;
        float denom = max(0.001, uTextMax - uTextMin);
        float p = clamp((uv.x - uTextMin) / denom, 0.0, 1.0);
        float filled = 1.0 - smoothstep(uProgress, uProgress + uFeather, p);
        float edge = 1.0 - smoothstep(0.0, uFeather * 2.8, abs(p - uProgress));
        vec3 color = mix(uBaseColor, uHiColor, filled * 0.88);
        color += uGlowColor * edge * 0.14;
        color = mix(color, color + uSolarColor * 0.34, uSolar * (0.25 + filled * 0.45));
        color += uSolarColor * edge * uSolar * 0.22;
        float lum = dot(color, vec3(0.299, 0.587, 0.114));
        color += vec3(max(0.0, 0.30 - lum));
        gl_FragColor = vec4(color, mask * uOpacity);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide
  })
}

interface LyricMeshData {
  textMat: THREE.ShaderMaterial
  readabilityMat: THREE.MeshBasicMaterial
  glowMat: THREE.MeshBasicMaterial
  sunMat: THREE.MeshBasicMaterial
  sparkMat: THREE.ShaderMaterial
  transMat: THREE.MeshBasicMaterial | null
  sun: THREE.Mesh
  glow: THREE.Mesh
  sparks: THREE.Points
  basePositions: Float32Array
  textWorldW: number
  textWorldH: number
  disposables: Array<{ dispose(): void }>
}

interface ActiveLyricMesh {
  group: THREE.Group
  data: LyricMeshData
  age: number
  floatSeed: number
}

function buildLyricMesh(
  text: string,
  transText: string | undefined,
  pal: LyricPalette,
  hasKaraoke: boolean,
  uPixel: { value: number }
): ActiveLyricMesh {
  const disposables: Array<{ dispose(): void }> = []
  const mask = makeLyricMask(text)
  disposables.push(mask.texture)
  const textWorldW = WORLD_W * (mask.textWidth / mask.width)
  const textWorldH = WORLD_H * (mask.textHeight / mask.height)

  const group = new THREE.Group()
  group.renderOrder = 42
  group.position.set((Math.random() - 0.5) * 0.08, 0.2, 1.46)
  group.scale.setScalar(0.96)

  // 太阳暖辉板(additive,共享缓存纹理)
  const sunMat = new THREE.MeshBasicMaterial({
    map: getSunBloomTexture(),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    color: lyricColor(pal.highlight || pal.secondary || pal.primary, '#ffe7a6', 0.5)
  })
  disposables.push(sunMat)
  let sunWorldW = Math.max(textWorldW + WORLD_H * 1.1, textWorldW * 1.18)
  sunWorldW = Math.min(WORLD_W * 1.16, Math.max(WORLD_H * 1.35, sunWorldW))
  const sunWorldH = Math.max(WORLD_H * 1.02, Math.min(WORLD_H * 1.54, WORLD_H + textWorldW * 0.07))
  const sunGeo = new THREE.PlaneGeometry(sunWorldW, sunWorldH, 1, 1)
  disposables.push(sunGeo)
  const sun = new THREE.Mesh(sunGeo, sunMat)
  sun.renderOrder = 40
  sun.position.set(0, 0.02, -0.03)
  sun.scale.set(0.78, 0.58, 1)
  group.add(sun)

  // 文字辉光板(additive)
  const glowInfo = makeGlowTexture(mask)
  disposables.push(glowInfo.texture)
  const glowMat = new THREE.MeshBasicMaterial({
    map: glowInfo.texture,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    color: lyricColor(pal.glowColor || pal.secondary, '#9cffdf', 0.36)
  })
  disposables.push(glowMat)
  let glowWorldW = textWorldW * (glowInfo.width / Math.max(1, glowInfo.textWidth))
  glowWorldW = Math.min(WORLD_W * 1.1, Math.max(textWorldW + WORLD_H * 0.38, glowWorldW))
  const glowWorldH = Math.min(WORLD_H * 1.42, Math.max(WORLD_H * 0.92, WORLD_H * (glowInfo.height / mask.height)))
  const glowGeo = new THREE.PlaneGeometry(glowWorldW, glowWorldH, 1, 1)
  disposables.push(glowGeo)
  const glow = new THREE.Mesh(glowGeo, glowMat)
  glow.renderOrder = 41
  glow.scale.set(1.0, 1.06, 1)
  group.add(glow)

  // 黑白描边可读性板:白色描边部分跟随封面调色板轻度上色,
  // 避免在暖/冷色氛围光中露出与四周不协调的纯灰色
  const readabilityTex = makeReadabilityTexture(mask)
  disposables.push(readabilityTex)
  const readabilityMat = new THREE.MeshBasicMaterial({
    map: readabilityTex,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    color: lyricColor(pal.glowColor || pal.secondary || pal.primary, '#c9d6e6', 0.7)
  })
  disposables.push(readabilityMat)
  const planeGeo = new THREE.PlaneGeometry(WORLD_W, WORLD_H, 1, 1)
  disposables.push(planeGeo)
  const readability = new THREE.Mesh(planeGeo, readabilityMat)
  readability.renderOrder = 42
  readability.position.set(0, 0, -0.012)
  group.add(readability)

  // 文字本体(KTV 进度扫光)
  const textMat = makeTextMaterial(mask, pal, hasKaraoke)
  disposables.push(textMat)
  const textMesh = new THREE.Mesh(planeGeo, textMat)
  textMesh.renderOrder = 43
  group.add(textMesh)

  // 翻译行:小号静态 mask,色用高亮色压暗,透明度跟随主行
  let transMat: THREE.MeshBasicMaterial | null = null
  if (transText) {
    const transMask = makeLyricMask(transText, { maxFont: 60, minFont: 28 })
    disposables.push(transMask.texture)
    transMat = new THREE.MeshBasicMaterial({
      map: transMask.texture,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
      color: lyricColor(pal.highlight || pal.primary, '#d6f8ff', 0.44)
    })
    disposables.push(transMat)
    const transWorldW = WORLD_W * 0.72
    const transWorldH = transWorldW * MASK_ASPECT
    const transGeo = new THREE.PlaneGeometry(transWorldW, transWorldH, 1, 1)
    disposables.push(transGeo)
    const transMesh = new THREE.Mesh(transGeo, transMat)
    transMesh.renderOrder = 43
    const transTextWorldH = transWorldH * (transMask.textHeight / transMask.height)
    transMesh.position.set(0, -(textWorldH / 2 + transTextWorldH / 2 + 0.05), 0.004)
    group.add(transMesh)
  }

  // 文字周围的环绕星点
  const pgeo = new THREE.BufferGeometry()
  disposables.push(pgeo)
  const ppos = new Float32Array(SPARK_COUNT * 3)
  const pseed = new Float32Array(SPARK_COUNT)
  for (let i = 0; i < SPARK_COUNT; i++) {
    const angle = Math.random() * Math.PI * 2
    const ring = 0.78 + Math.pow(Math.random(), 1.45) * 0.58
    const rx = textWorldW * (0.5 + Math.random() * 0.22) + 0.1
    const ry = WORLD_H * (0.42 + Math.random() * 0.22) + 0.08
    ppos[i * 3] = Math.cos(angle) * rx * ring + (Math.random() - 0.5) * textWorldW * 0.12
    ppos[i * 3 + 1] = Math.sin(angle) * ry * ring + (Math.random() - 0.5) * WORLD_H * 0.14
    ppos[i * 3 + 2] = (Math.random() - 0.5) * 0.24
    pseed[i] = Math.random() * 1000
  }
  pgeo.setAttribute('position', new THREE.BufferAttribute(ppos, 3))
  pgeo.setAttribute('seed', new THREE.BufferAttribute(pseed, 1))
  const sparkMat = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: getDotSpriteTexture() },
      uSize: { value: 0.052 },
      uOpacity: { value: 0 },
      uColor: { value: lyricColor(pal.highlight || pal.secondary || pal.primary, '#fff7d2', 0.3) },
      uPixel: uPixel
    },
    vertexShader: /* glsl */ `
      attribute float seed;
      uniform float uSize, uPixel;
      varying float vSeed;
      void main(){
        vSeed = seed;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float jitter = 0.58 + fract(sin(seed * 19.17) * 43758.5453) * 1.18;
        float depth = clamp(2.2 / max(0.35, -mv.z), 0.54, 1.55);
        gl_PointSize = uSize * jitter * depth * uPixel * 120.0;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform vec3 uColor;
      uniform float uOpacity;
      varying float vSeed;
      void main(){
        vec4 tex = texture2D(uMap, gl_PointCoord);
        float twinkle = 0.72 + fract(sin(vSeed * 7.31) * 91.7) * 0.28;
        gl_FragColor = vec4(uColor * twinkle, tex.a * uOpacity);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending
  })
  disposables.push(sparkMat)
  const sparks = new THREE.Points(pgeo, sparkMat)
  sparks.renderOrder = 44
  group.add(sparks)

  return {
    group,
    age: 0,
    floatSeed: Math.random() * 100,
    data: {
      textMat,
      readabilityMat,
      glowMat,
      sunMat,
      sparkMat,
      transMat,
      sun,
      glow,
      sparks,
      basePositions: ppos.slice(0),
      textWorldW,
      textWorldH,
      disposables
    }
  }
}

function applyPaletteToMesh(mesh: ActiveLyricMesh | null, pal: LyricPalette): void {
  if (!mesh) return
  const u = mesh.data.textMat.uniforms
  u.uBaseColor.value.copy(lyricColor(pal.primary, '#d6f8ff', 0.38))
  u.uHiColor.value.copy(lyricColor(pal.highlight || pal.primary, '#fff0b8', 0.48))
  u.uGlowColor.value.copy(lyricColor(pal.glowColor || pal.secondary, '#9cffdf', 0.36))
  u.uSolarColor.value.copy(lyricColor(pal.highlight || pal.secondary || pal.primary, '#fff0b8', 0.5))
  mesh.data.glowMat.color.copy(lyricColor(pal.glowColor || pal.secondary, '#9cffdf', 0.36))
  mesh.data.readabilityMat.color.copy(lyricColor(pal.glowColor || pal.secondary || pal.primary, '#c9d6e6', 0.7))
  mesh.data.sparkMat.uniforms.uColor.value.copy(lyricColor(pal.highlight || pal.secondary || pal.primary, '#fff0b8', 0.46))
  mesh.data.sunMat.color.copy(lyricColor(pal.highlight || pal.secondary || pal.primary, '#fff0b8', 0.5))
  if (mesh.data.transMat) mesh.data.transMat.color.copy(lyricColor(pal.highlight || pal.primary, '#d6f8ff', 0.44))
}

function disposeMesh(mesh: ActiveLyricMesh | null): void {
  if (!mesh) return
  mesh.group.parent?.remove(mesh.group)
  for (const d of mesh.data.disposables) d.dispose()
}

/** 行进度:逐字歌词按字符时间窗插值,普通歌词按行时长线性 + smoothstep */
function lineProgress(now: number, idx: number, lines: LyricLineData[], wordLine?: WordLyricLine): number {
  const line = lines[idx]
  if (!line) return 0
  if (wordLine && wordLine.words.length) {
    const charCount = wordLine.words.reduce((s, w) => s + w.text.length, 0)
    if (charCount > 0) {
      const nowMs = (now - wordLine.time) * 1000 + 30
      let c0 = 0
      let lastP = 0
      for (const w of wordLine.words) {
        const ws = w.startMs
        const we = ws + Math.max(80, w.durationMs ?? 240)
        if (nowMs < ws) return lastP
        const local = nowMs >= we ? 1 : Math.min(1, Math.max(0, (nowMs - ws) / Math.max(80, we - ws)))
        lastP = Math.max(lastP, (c0 + w.text.length * local) / charCount)
        if (nowMs < we) return lastP
        c0 += w.text.length
      }
      return 1
    }
  }
  const adjNow = now + 0.02
  const next = lines[idx + 1]
  const nextT = next && next.time > line.time ? next.time : line.time + 4.8
  const span = Math.max(0.75, nextT - line.time)
  const p = Math.min(1, Math.max(0, (adjNow - line.time) / span))
  return p * p * (3 - 2 * p)
}

export function StageLyrics3D() {
  const rootRef = useRef<THREE.Group>(null)
  const currentRef = useRef<ActiveLyricMesh | null>(null)
  const outgoingRef = useRef<ActiveLyricMesh[]>([])
  const palRef = useRef<LyricPalette>(silverBlueLyricPalette())
  const sunColorRef = useRef(new THREE.Color(0xffe6a4))
  const sunHotColorRef = useRef(new THREE.Color(0xfff4cc))

  const prevBassAboveRef = useRef(false)
  const lastBeatAtRef = useRef(-10)
  const beatPulseRef = useRef(0)
  const energySmoothRef = useRef(0)
  const beatGlowRef = useRef(0)
  const highBloomRef = useRef(0)
  const fitScaleRef = useRef(1)

  const dpr = useThree((s) => s.viewport.dpr)
  const uPixel = useMemo(() => ({ value: 1 }), [])
  useEffect(() => {
    uPixel.value = dpr
  }, [dpr, uPixel])

  const currentIndex = useLyricsStore((s) => s.currentIndex)
  const lines = useLyricsStore((s) => s.lines)
  const wordLines = useLyricsStore((s) => s.wordLines)
  const translation = useLyricsStore((s) => s.translation)
  const showTranslation = useSettingsStore((s) => s.lyricsShowTranslation)
  const fontFamily = useSettingsStore((s) => s.fontFamily)
  const coverUrl = usePlayerStore((s) => s.currentTrack?.cover)

  // 封面调色板:64×64 采样推导,应用到在场的所有歌词面板
  useEffect(() => {
    if (!coverUrl) {
      palRef.current = silverBlueLyricPalette()
      return
    }
    let cancelled = false
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      if (cancelled) return
      try {
        const cv = document.createElement('canvas')
        cv.width = cv.height = 64
        const ctx = cv.getContext('2d', { willReadFrequently: true })
        if (!ctx) return
        ctx.drawImage(img, 0, 0, 64, 64)
        const pal = lyricPaletteFromCoverPixels(ctx.getImageData(0, 0, 64, 64).data, 64, 64)
        palRef.current = pal
        sunColorRef.current.copy(lyricColor(pal.glowColor || pal.secondary || pal.primary, '#ffe6a4', 0.44))
        sunHotColorRef.current.copy(lyricColor(pal.highlight || pal.primary, '#fff4cc', 0.54))
        applyPaletteToMesh(currentRef.current, pal)
        for (const m of outgoingRef.current) applyPaletteToMesh(m, pal)
      } catch {
        /* 跨域污染等:保留旧调色板 */
      }
    }
    img.src = api.url('/proxy/cover', { url: coverUrl })
    return () => {
      cancelled = true
      img.onload = null
      img.src = ''
    }
  }, [coverUrl])

  // 字体设置变化时清缓存,下一行重建即用新字体
  useEffect(() => {
    invalidateLyricFontCache()
  }, [fontFamily])

  // 切行:旧行进 outgoing 淡出,新行重建浮入
  const text = currentIndex >= 0 ? (lines[currentIndex]?.text ?? '').trim() : ''
  const transText = showTranslation ? translation[currentIndex]?.text?.trim() || undefined : undefined
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    if (currentRef.current) {
      currentRef.current.age = 0
      outgoingRef.current.push(currentRef.current)
      currentRef.current = null
    }
    if (!text) return
    const mesh = buildLyricMesh(text, transText, palRef.current, !!wordLines[currentIndex]?.words?.length, uPixel)
    root.add(mesh.group)
    currentRef.current = mesh
    // 依赖 currentIndex 保证相邻两行文字相同也重建(原版按行号切换)
  }, [currentIndex, text, transText, wordLines, uPixel])

  // 卸载清场
  useEffect(
    () => () => {
      disposeMesh(currentRef.current)
      currentRef.current = null
      for (const m of outgoingRef.current) disposeMesh(m)
      outgoingRef.current = []
    },
    []
  )

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.1)
    const t = state.clock.getElapsedTime()
    const params = useSettingsStore.getState().lyrics3d

    // 音频能量与节拍包络
    const engine = usePlayerStore.getState()._engine()
    const bands = bandEnergiesFrom(engine.getFrequencyData())
    const bassSum = bands.subBass + bands.bass
    const bass01 = Math.min(1, bassSum * 0.5)
    if (bassSum > BEAT_THRESHOLD && !prevBassAboveRef.current && t - lastBeatAtRef.current > BEAT_COOLDOWN) {
      beatPulseRef.current = 1
      lastBeatAtRef.current = t
    }
    prevBassAboveRef.current = bassSum > BEAT_THRESHOLD * 0.75
    beatPulseRef.current = Math.max(0, beatPulseRef.current - dt * 3.2)
    const beatPulse = beatPulseRef.current
    energySmoothRef.current += (bands.energy - energySmoothRef.current) * 0.06

    // 辉光驱动:glowStrength 滑块(默认 1)→ 原版 lyricGlowStrength 默认 0.5
    const lyricGlowStrength = Math.min(0.85, Math.max(0, 0.5 * params.glowStrength))
    const glowDrive = Math.min(1.7, lyricGlowStrength / 0.5)
    const glowBreath = lyricGlowStrength > 0 ? 0.5 + 0.5 * Math.sin(t * 1.05) : 0
    const musicBloom = Math.max(energySmoothRef.current, beatPulse * 0.1)
    const beatGlowRaw = lyricGlowStrength > 0 ? beatPulse * 1.22 : 0
    beatGlowRef.current += (beatGlowRaw - beatGlowRef.current) * (beatGlowRaw > beatGlowRef.current ? 0.32 : 0.1)
    const beatGlow = beatGlowRef.current
    let solarBloom =
      lyricGlowStrength > 0
        ? (0.18 + glowBreath * 0.16 + musicBloom * 0.9 + beatGlow * 1.18 + Math.sin(t * 0.37 + 1.2) * 0.035) * glowDrive
        : 0
    solarBloom = Math.max(0, Math.min(1.45, solarBloom))
    highBloomRef.current += (solarBloom - highBloomRef.current) * (solarBloom > highBloomRef.current ? 0.075 : 0.05)
    const solar = highBloomRef.current
    const sparksOn = lyricGlowStrength > 0.025

    // 视口适配:按歌词所在深度的可视宽度收缩整组,窄面板不溢出
    const root = rootRef.current
    if (root) {
      const cam = state.camera as THREE.PerspectiveCamera
      const distToLyrics = Math.max(1.4, Math.abs(cam.position.z - 1.46))
      const visibleH = 2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) * distToLyrics
      const visibleW = visibleH * cam.aspect
      const need = currentRef.current ? Math.max(2.4, currentRef.current.data.textWorldW) : WORLD_W
      const fit = Math.min(1, (visibleW * 0.84) / need)
      fitScaleRef.current += (fit - fitScaleRef.current) * (fit < fitScaleRef.current ? 0.18 : 0.1)
      root.scale.setScalar(Math.max(0.42, fitScaleRef.current))
    }

    // 当前行:浮入 + 呼吸漂浮 + 辉光/太阳/星点动态 + KTV 进度
    const cur = currentRef.current
    if (cur) {
      cur.age += dt
      const a0 = Math.min(1, cur.age / 0.52)
      const a = a0 * a0 * (3 - 2 * a0)
      const d = cur.data
      const seed = cur.floatSeed

      const opacity = THREE.MathUtils.clamp(
        d.textMat.uniforms.uOpacity.value + (0.96 - d.textMat.uniforms.uOpacity.value) * 0.16,
        0,
        1
      )
      d.textMat.uniforms.uOpacity.value = opacity
      d.readabilityMat.opacity += (opacity * 0.86 - d.readabilityMat.opacity) * 0.16
      d.textMat.uniforms.uSolar.value += (solar - d.textMat.uniforms.uSolar.value) * 0.12
      if (d.transMat) d.transMat.opacity += (opacity * 0.72 - d.transMat.opacity) * 0.16

      const warmth = Math.max(0, Math.min(1, solar * 1.1))
      const glowTarget = lyricGlowStrength > 0 ? Math.min(1.0, (0.075 + solar * 0.34 + beatGlow * 0.16) * Math.min(3, glowDrive)) : 0
      d.glowMat.opacity += (glowTarget - d.glowMat.opacity) * (glowTarget > d.glowMat.opacity ? 0.095 : 0.055)
      d.glowMat.color.copy(lyricColor(palRef.current.glowColor || palRef.current.secondary, '#9cffdf', 0.36)).lerp(sunHotColorRef.current, warmth)

      const sparkTarget = sparksOn ? Math.min(0.42, (0.1 + solar * 0.14 + beatGlow * 0.1) * Math.min(1.6, glowDrive)) : 0
      const sparkOpacity = d.sparkMat.uniforms.uOpacity.value
      d.sparkMat.uniforms.uOpacity.value = sparkOpacity + (sparkTarget - sparkOpacity) * (sparkTarget > sparkOpacity ? 0.13 : 0.075)
      d.sparkMat.uniforms.uSize.value +=
        ((sparksOn ? 0.05 + solar * 0.016 + beatGlow * 0.026 + bass01 * 0.008 : 0.035) - d.sparkMat.uniforms.uSize.value) * 0.12
      d.sparkMat.uniforms.uColor.value.copy(sunHotColorRef.current).lerp(sunColorRef.current, 0.22 + solar * 0.18)
      d.sparks.visible = d.sparkMat.uniforms.uOpacity.value > 0.015

      const sunTarget =
        lyricGlowStrength > 0 ? Math.min(0.88, (Math.pow(Math.min(1.35, solar), 1.08) * 0.28 + beatGlow * 0.2) * Math.min(2.4, glowDrive)) : 0
      d.sunMat.opacity += (sunTarget - d.sunMat.opacity) * 0.055
      d.sunMat.color.copy(sunColorRef.current).lerp(sunHotColorRef.current, solar * 0.55)
      const beatScale = beatGlow * 0.24
      d.sun.scale.set(
        0.82 + solar * 0.36 + beatScale + Math.sin(t * 1.6) * solar * 0.018,
        0.6 + solar * 0.34 + beatScale * 0.72 + Math.cos(t * 1.25) * solar * 0.02,
        1
      )
      const breathe = Math.sin(t * 0.92 + seed) * 0.05 + Math.sin(t * 0.41 + seed * 0.7) * 0.028
      cur.group.scale.setScalar(0.96 + a * 0.055 + breathe + bass01 * 0.038 + beatPulse * 0.014)
      cur.group.position.y += (0.18 + Math.sin(t * 0.55 + seed) * 0.055 + Math.sin(t * 1.35 + seed) * 0.014 - cur.group.position.y) * 0.075
      cur.group.position.z += (1.48 + Math.cos(t * 0.48 + seed) * 0.08 - cur.group.position.z) * 0.08
      cur.group.rotation.z = Math.sin(t * 0.34 + seed) * 0.018

      // 星点漂移(不整体旋转,避免视觉上"转圈")
      if (d.sparks.visible) {
        d.sparks.rotation.x = Math.sin(t * 0.12 + seed) * 0.012
        const pos = d.sparks.geometry.getAttribute('position') as THREE.BufferAttribute
        const arr = pos.array as Float32Array
        const base = d.basePositions
        for (let si = 0; si < SPARK_COUNT; si++) {
          const s = si * 12.989 + seed
          const dustBreath = 0.62 + 0.38 * Math.sin(t * (0.32 + (si % 7) * 0.025) + s)
          arr[si * 3] = base[si * 3] + Math.sin(t * (0.18 + (si % 5) * 0.025) + s) * (0.045 + bass01 * 0.03 + beatGlow * 0.052) + Math.cos(t * 0.11 + s) * 0.018 * dustBreath
          arr[si * 3 + 1] = base[si * 3 + 1] + Math.cos(t * (0.16 + (si % 6) * 0.024) + s) * (0.042 + beatGlow * 0.046) + Math.sin(t * 0.13 + s) * 0.016 * dustBreath
          arr[si * 3 + 2] = base[si * 3 + 2] + Math.sin(t * (0.24 + (si % 4) * 0.035) + s) * (0.036 + beatGlow * 0.028)
        }
        pos.needsUpdate = true
      }

      // KTV 进度
      const lyrics = useLyricsStore.getState()
      const now = engine.position + lyrics.offsetSec
      if (lyrics.currentIndex >= 0) {
        d.textMat.uniforms.uProgress.value = lineProgress(now, lyrics.currentIndex, lyrics.lines, lyrics.wordLines[lyrics.currentIndex])
      }
    }

    // 淡出行:透明度衰减 + 向后上方飘走
    for (let i = outgoingRef.current.length - 1; i >= 0; i--) {
      const m = outgoingRef.current[i]
      m.age += dt
      const a0 = Math.min(1, m.age / 0.38)
      const a = a0 * a0 * (3 - 2 * a0)
      const opacity = (1 - a) * 0.72
      const d = m.data
      d.textMat.uniforms.uOpacity.value = opacity
      d.readabilityMat.opacity = opacity * 0.58
      d.textMat.uniforms.uSolar.value *= 0.86
      d.glowMat.opacity = lyricGlowStrength > 0 ? opacity * 0.08 * lyricGlowStrength : 0
      d.sparkMat.uniforms.uOpacity.value = sparksOn ? Math.max(opacity * 0.24, (1 - a) * 0.18) * lyricGlowStrength : 0
      d.sunMat.opacity = lyricGlowStrength > 0 ? opacity * 0.08 * lyricGlowStrength : 0
      if (d.transMat) d.transMat.opacity = opacity * 0.6
      m.group.position.z -= dt * 0.26
      m.group.position.y += dt * 0.08
      m.group.scale.setScalar(0.98 - a * 0.06)
      if (a0 >= 1) {
        disposeMesh(m)
        outgoingRef.current.splice(i, 1)
      }
    }
  })

  return <group ref={rootRef} />
}
