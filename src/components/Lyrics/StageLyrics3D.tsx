import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useReducedMotion } from 'motion/react'
import * as THREE from 'three'
import { useLyricsStore } from '../../stores/lyrics'
import { usePlayerStore } from '../../stores/player'
import { useSettingsStore } from '../../stores/settings'
import { useCoverLyricPalette } from '../../hooks/useCoverLyricPalette'
import { StageGlassBackdrop } from './stage-glass-backdrop'
import { frameBlend } from '../../lib/frame-blend'
import { bandEnergiesFrom } from '../../lib/audio-energy'
import { lyricPlaybackPosition } from '../../lib/lyric-playback-position'
import { getDotSpriteTexture } from '../../lib/dot-texture'
import { lightLyricPalette, silverBlueLyricPalette, type LyricPalette } from '../../lib/lyric-palette'
import {
  makeLyricMask,
  makeReadabilityTexture,
  makeGlowTexture,
  getSunBloomTexture,
  invalidateLyricFontCache
} from './stage-lyric-textures'
import type { Lyrics3dDisplayMode, Lyrics3dStyle, WordLyricLine } from '../../types/domain'
import { createLyricStarRiver } from './stage-lyric-river'
import { LYRIC_STYLE_LOOKS, lyricStyleFrame } from './stage-lyric-motion'
import { advanceLyricScroll } from './stage-lyric-scroll'
import { hasPreciseWordTiming, stageLyricProgress, stageWordTimeline } from './stage-lyric-progress'

/**
 * 3D 歌词轨道（参考 Mineradio 2.2.0 / GPL-3.0 的多行布局与动效参数）:歌词以四层结构
 * 悬浮在 3D 场景中——太阳暖辉板(additive)+ 文字辉光板(additive)+ 黑白描边
 * 可读性板 + 文字 mask 板(KTV 进度扫光 shader),外加 132 颗环绕星点。
 * 当前行使用完整辉光材质，上下文使用轻量文字板；切行时整条轨道连续滚动，
 * 深度、缩放和边缘透明度共同形成空间层次。调色板从封面像素推导
 * (lyric-palette.ts),辉光/太阳随节拍与能量呼吸;翻译行是原版没有的补充。
 * 相对原版简化:去掉骷髅/书架/壁纸联动、镜头锁定布局滑杆与自定义配色；
 * 保留本项目已有的封面取色、KTV 扫光和环绕星点，补充五轨星河与节拍辉光跟随。
 */

const WORLD_W = 6.1
const MASK_ASPECT = 384 / 2048
const WORLD_H = WORLD_W * MASK_ASPECT
const BEAT_THRESHOLD = 0.38
const BEAT_COOLDOWN = 0.18
const SPARK_COUNT = 132
const PAST_LYRIC_TINT = new THREE.Color('#87909f')

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

/** 每个字用原生时间戳独立点亮，时间纹理固定，仅更新播放器经过时间。 */
function makeTextMaterial(mask: ReturnType<typeof makeLyricMask>, pal: LyricPalette, wordMap: THREE.DataTexture, wordCount: number) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: mask.texture },
      uWordMap: { value: wordMap },
      uWordCount: { value: wordCount },
      uElapsed: { value: -1 },
      uProgress: { value: 0 },
      uTextMin: { value: mask.textMin },
      uTextMax: { value: mask.textMax },
      uRow1: { value: new THREE.Vector2(...mask.rowRanges[0]) },
      uRow2: { value: new THREE.Vector2(...(mask.rowRanges[1] ?? mask.rowRanges[0])) },
      uWrapped: { value: mask.lines.length === 2 ? 1 : 0 },
      uOpacity: { value: 0 },
      uPlaybackLight: { value: usePlayerStore.getState().status === 'playing' ? 1 : 0 },
      uBaseColor: { value: lyricColor(pal.primary, '#d6f8ff', 0.38) },
      uHiColor: { value: lyricColor(pal.highlight || pal.primary, '#fff0b8', 0.48) },
      uGlowColor: { value: lyricColor(pal.glowColor || pal.secondary, '#9cffdf', 0.36) },
      uSolarColor: { value: lyricColor(pal.highlight || pal.secondary || pal.primary, '#fff0b8', 0.5) },
      uFeather: { value: 0.03 },
      uSolar: { value: 0 },
      uTime: { value: 0 },
      uSweep: { value: -1 },
      uSheen: { value: 0 },
      uGlass: { value: 0 },
      uLightTheme: { value: 0 },
      uBackdrop: { value: null },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uBevel: { value: new THREE.Vector2(Math.max(1, mask.fontSize * 0.006) / mask.width, Math.max(1, mask.fontSize * 0.006) / mask.height) },
      uTextHeight: { value: mask.textHeight / mask.height },
      uPrism: { value: 0 },
      uGlitch: { value: 0 }
    },
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap, uWordMap;
      uniform float uWordCount, uElapsed;
      uniform float uProgress, uTextMin, uTextMax, uOpacity, uPlaybackLight, uFeather, uSolar;
      uniform float uTime, uSweep, uSheen, uPrism, uGlitch;
      uniform float uGlass, uTextHeight, uWrapped, uLightTheme;
      uniform vec2 uBevel, uResolution, uRow1, uRow2;
      uniform sampler2D uBackdrop;
      uniform vec3 uBaseColor, uHiColor, uGlowColor, uSolarColor;
      varying vec2 vUv;
      void main(){
        vec2 uv = gl_FrontFacing ? vUv : vec2(1.0 - vUv.x, vUv.y);
        float slice = floor(uv.y * 36.0);
        float jitter = sin(slice * 17.1 + floor(uTime * 12.0) * 2.7) * uGlitch;
        uv.x += jitter;
        float centerMask = texture2D(uMap, uv).a;
        float split = uPrism + uGlitch * 0.65;
        float leftMask = centerMask;
        float rightMask = centerMask;
        if (split > 0.00001) {
          leftMask = texture2D(uMap, uv + vec2(split, 0.0)).a;
          rightMask = texture2D(uMap, uv - vec2(split, 0.0)).a;
        }
        float mask = max(centerMask, max(leftMask, rightMask) * 0.65);
        if (mask < 0.01) discard;
        float denom = max(0.001, uTextMax - uTextMin);
        float p = clamp((uv.x - uTextMin) / denom, 0.0, 1.0);
        if (uWrapped > 0.5) {
          bool top = uv.y > 0.5;
          vec2 range = top ? uRow1 : uRow2;
          p = (top ? 0.0 : 0.5) + clamp((uv.x-range.x)/max(0.001,range.y-range.x),0.0,1.0)*0.5;
        }
        float filled = 1.0;
        float edge = 0.0;
        if (uWordCount > 0.0) {
          // 按字面边界二分定位，不按时间串行等待前一个字。
          float low = 0.0;
          float high = uWordCount - 1.0;
          for (int i = 0; i < 16; i++) {
            if (low >= high) break;
            float mid = floor((low + high) * 0.5);
            vec4 candidate = texture2D(uWordMap, vec2((mid + 0.5) / uWordCount, 0.5));
            if (p >= candidate.y) low = mid + 1.0;
            else high = mid;
          }
          vec4 word = texture2D(uWordMap, vec2((low + 0.5) / uWordCount, 0.5));
          float wordWidth = max(0.000001, word.y - word.x);
          float wordP = clamp((p - word.x) / wordWidth, 0.0, 1.0);
          float local = uElapsed < word.z ? 0.0 : (word.w <= 0.0 ? 1.0 : clamp((uElapsed - word.z) / word.w, 0.0, 1.0));
          filled = 0.0;
          if (local >= 1.0) filled = 1.0;
          else if (local > 0.0) {
            // 羽化只留在已唱一侧，未开始的字严格不点亮。
            float feather = min(0.15, uFeather / wordWidth);
            filled = 1.0 - smoothstep(max(0.0, local - feather), local, wordP);
            edge = (1.0 - smoothstep(0.0, feather * 2.8, abs(wordP - local))) * filled;
          }
        }
        if (uGlass > 0.5) {
          // 极细曲面边缘 + 真实场景折射，字面保持通透，不使用金属明暗分层。
          float up = texture2D(uMap, uv + vec2(0.0,uBevel.y)).a;
          float down = texture2D(uMap, uv - vec2(0.0,uBevel.y)).a;
          float left = texture2D(uMap, uv - vec2(uBevel.x,0.0)).a;
          float right = texture2D(uMap, uv + vec2(uBevel.x,0.0)).a;
          vec2 normal = vec2(left-right, down-up);
          float rim = clamp(length(normal),0.0,1.0);
          float height = clamp((uv.y-0.5)/max(0.01,uTextHeight)+0.5,0.0,1.0);
          vec2 screen = gl_FragCoord.xy / uResolution;
          vec2 refractUv = clamp(screen + (normal * 6.0 + vec2(0.0,(height-0.5)*2.0)) / uResolution, 0.001, 0.999);
          vec4 backdrop = texture2D(uBackdrop, refractUv);
          float reflectionOffset = (p+(height-0.5)*0.32-uSweep)*3.0;
          float reflection = exp(-reflectionOffset*reflectionOffset) * uSheen;
          float lightEdge = max(0.0, dot(normal, normalize(vec2(-0.45,0.9))));
          float backgroundLight = dot(backdrop.rgb,vec3(0.2126,0.7152,0.0722))*backdrop.a;
          // 沿用封面调色板：未唱主色、已唱高亮色；只调整亮度以保持玻璃通透。
          vec3 palette = mix(uBaseColor,uHiColor,filled*0.65);
          vec3 tint = palette / max(0.001,max(palette.r,max(palette.g,palette.b)));
          vec3 pearl = mix(mix(tint,vec3(1.0),0.48),tint*0.10,smoothstep(0.34,0.52,backgroundLight));
          // 透明区域交给正常 alpha 合成透出 CSS 底色，不能把空纹理当黑玻璃。
          vec3 glass = mix(pearl, backdrop.rgb, backdrop.a * (0.56-filled*0.08));
          glass += mix(pearl,uGlowColor,0.25) * (lightEdge*0.48+reflection*0.11);
          float alpha = (0.38+filled*0.17+rim*0.14) * centerMask*uOpacity;
          if (uLightTheme > 0.5) {
            glass = mix(palette, backdrop.rgb, backdrop.a * 0.14) + palette * (lightEdge * 0.12 + reflection * 0.06);
            alpha = (0.62+filled*0.17+rim*0.10) * centerMask*uOpacity;
          }
          gl_FragColor = vec4(glass * mix(0.62,1.0,uPlaybackLight), alpha);
          if (uLightTheme > 0.5) gl_FragColor = linearToOutputTexel(gl_FragColor);
          return;
        }
        vec3 color = mix(uBaseColor, uHiColor, filled * 0.88);
        color += uGlowColor * edge * 0.14;
        color = mix(color, color + uSolarColor * 0.34, uSolar * (0.25 + filled * 0.45));
        color += uSolarColor * edge * uSolar * 0.22;
        float sweepWidth = uLightTheme > 0.5 ? 0.11 : 0.075;
        float sweep = 1.0 - smoothstep(0.0, sweepWidth, abs(p + (uv.y - 0.5) * 0.16 - uSweep));
        if (uLightTheme > 0.5) {
          // 浅底的深彩色字面需要独立亮带，不能再用深色高亮色叠加微弱亮度。
          vec3 sheenColor = uHiColor / max(0.001, max(uHiColor.r, max(uHiColor.g, uHiColor.b))) * 0.8 + vec3(0.12);
          color = mix(color, sheenColor, clamp(sweep * uSheen, 0.0, 1.0));
        } else {
          color += uHiColor * sweep * uSheen;
        }
        color += vec3(leftMask - centerMask, 0.0, rightMask - centerMask) * 0.42;
        float lum = dot(color, vec3(0.299, 0.587, 0.114));
        // 深色舞台保留原有亮度补偿；浅色字面直接使用封面深彩色调色板。
        if (uLightTheme < 0.5) {
          color = mix(color, vec3(1.0), clamp((0.58-lum)/max(0.001,1.0-lum),0.0,1.0));
        }
        gl_FragColor = vec4(color * mix(0.62,1.0,uPlaybackLight), mask * uOpacity);
        if (uLightTheme > 0.5) gl_FragColor = linearToOutputTexel(gl_FragColor);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide
  })
}

interface LyricMeshData {
  wordBoundaries: number[]
  rowCount: number
  accentMat: THREE.ShaderMaterial
  textMat: THREE.ShaderMaterial
  readabilityMat: THREE.MeshBasicMaterial
  glowMat: THREE.MeshBasicMaterial
  sunMat: THREE.MeshBasicMaterial
  sparkMat: THREE.ShaderMaterial
  transMat: THREE.MeshBasicMaterial | null
  sun: THREE.Mesh
  glow: THREE.Mesh
  sparks: THREE.Points
  textWorldW: number
  textWorldH: number
  disposables: Array<{ dispose(): void }>
}

interface ActiveLyricMesh {
  group: THREE.Group
  data: LyricMeshData
  age: number
  floatSeed: number
  entryOpacity: number
  entryScale: number
  lineIndex: number
  entryDirection: number
  exitDirection: number
  exitStartX: number
  exitStartZ: number
  exitStartScale: number
  exitStartOpacity: number
}

function buildLyricMesh(
  text: string,
  transText: string | undefined,
  pal: LyricPalette,
  wordLine: WordLyricLine | undefined,
  uPixel: { value: number },
  lineIndex: number,
  entryDirection: number,
  lineStep: number
): ActiveLyricMesh {
  const disposables: Array<{ dispose(): void }> = []
  const hasKaraoke = hasPreciseWordTiming(wordLine)
  const mask = makeLyricMask(text, { words: hasKaraoke ? wordLine?.words : undefined })
  disposables.push(mask.texture)
  const wordData = stageWordTimeline(wordLine, mask.wordBoundaries)
  const wordCount = wordData.length / 4
  const wordMap = new THREE.DataTexture(wordCount ? wordData : new Float32Array(4), Math.max(1, wordCount), 1, THREE.RGBAFormat, THREE.FloatType)
  wordMap.needsUpdate = true
  disposables.push(wordMap)
  const textWorldW = WORLD_W * (mask.textWidth / mask.width)
  const textWorldH = WORLD_H * (mask.textHeight / mask.height)

  const group = new THREE.Group()
  group.renderOrder = 42
  group.position.set((Math.random() - 0.5) * 0.04, 0.18 + entryDirection * lineStep * 0.72, 1.46)
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

  // 中性字形暗影隔开复杂背景，不随封面染色，也不添加矩形底板。
  const readabilityTex = makeReadabilityTexture(mask)
  disposables.push(readabilityTex)
  const readabilityMat = new THREE.MeshBasicMaterial({
    map: readabilityTex,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    color: 0xffffff
  })
  disposables.push(readabilityMat)
  const planeGeo = new THREE.PlaneGeometry(WORLD_W, WORLD_H, 1, 1)
  disposables.push(planeGeo)
  const readability = new THREE.Mesh(planeGeo, readabilityMat)
  readability.renderOrder = 42
  readability.position.set(0, 0, -0.012)
  group.add(readability)

  // 文字本体(KTV 进度扫光)
  const textMat = makeTextMaterial(mask, pal, wordMap, wordCount)
  disposables.push(textMat)
  const textMesh = new THREE.Mesh(planeGeo, textMat)
  textMesh.renderOrder = 43
  group.add(textMesh)

  // 快切进度线；其他样式完全隐藏，玻璃材质直接绘制在字面上。
  const accentMat = new THREE.ShaderMaterial({
    uniforms: {
      uMode: { value: 0 },
      uOpacity: { value: 0 },
      uProgress: { value: 0 },
      uColor: { value: lyricColor(pal.primary, '#d6f8ff', 0.38) }
    },
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: /* glsl */ `
      uniform float uMode, uOpacity, uProgress;
      uniform vec3 uColor;
      varying vec2 vUv;
      void main() {
        if (uMode < 1.5) discard;
        vec2 uv = gl_FrontFacing ? vUv : vec2(1.0-vUv.x, vUv.y);
        float line = (1.0-smoothstep(0.015, 0.035, abs(uv.y-0.10)))
          * step(0.07, uv.x) * step(uv.x, 0.93);
        float filled = 1.0-smoothstep(uProgress, uProgress+0.015, (uv.x-0.07)/0.86);
        gl_FragColor = vec4(uColor, line * (0.16+filled*0.72) * uOpacity);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide
  })
  const accentGeo = new THREE.PlaneGeometry(textWorldW + 0.5, textWorldH + 0.55)
  const accent = new THREE.Mesh(accentGeo, accentMat)
  accent.renderOrder = 40
  accent.position.set(0, -0.04, -0.04)
  group.add(accent)
  disposables.push(accentMat, accentGeo)

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
      uPixel: uPixel,
      uTime: { value: 0 },
      uBass: { value: 0 },
      uBeat: { value: 0 }
    },
    vertexShader: /* glsl */ `
      attribute float seed;
      uniform float uSize, uPixel, uTime, uBass, uBeat;
      varying float vSeed;
      void main(){
        vSeed = seed;
        float phase = seed * 12.989;
        vec3 p = position;
        p.x += sin(uTime * (0.18 + mod(seed, 5.0) * 0.025) + phase) * (0.045 + uBass * 0.03 + uBeat * 0.05);
        p.y += cos(uTime * (0.16 + mod(seed, 6.0) * 0.024) + phase) * (0.042 + uBeat * 0.045);
        p.z += sin(uTime * (0.24 + mod(seed, 4.0) * 0.035) + phase) * (0.036 + uBeat * 0.028);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
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
    entryOpacity: 0,
    entryScale: 0.96,
    lineIndex,
    entryDirection,
    exitDirection: entryDirection,
    exitStartX: group.position.x,
    exitStartZ: group.position.z,
    exitStartScale: group.scale.x,
    exitStartOpacity: 0,
    data: {
      wordBoundaries: mask.wordBoundaries,
      rowCount: mask.lines.length,
      accentMat,
      textMat,
      readabilityMat,
      glowMat,
      sunMat,
      sparkMat,
      transMat,
      sun,
      glow,
      sparks,
      textWorldW,
      textWorldH,
      disposables
    }
  }
}

interface ContextLyricMesh {
  rowCount: number
  textWorldH: number
  group: THREE.Group
  material: THREE.MeshBasicMaterial
  baseColor: THREE.Color
  glowMaterial: THREE.MeshBasicMaterial
  transMaterial: THREE.MeshBasicMaterial | null
  lineIndex: number
  text: string
  transText: string
  seed: number
  disposables: Array<{ dispose(): void }>
}

/** 上下文行只保留轻量文字板，避免把当前行的辉光和粒子成本复制多份。 */
function buildContextLyricMesh(
  text: string,
  transText: string,
  pal: LyricPalette,
  lineIndex: number,
  initialY: number
): ContextLyricMesh {
  const mask = makeLyricMask(text, { maxFont: 112, minFont: 36, textureScale: 0.65 })
  const material = new THREE.MeshBasicMaterial({
    map: mask.texture,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    color: lyricColor(pal.primary, '#d6f8ff', 0.38)
  })
  const width = WORLD_W * 0.86
  const geometry = new THREE.PlaneGeometry(width, width * MASK_ASPECT, 1, 1)
  const mesh = new THREE.Mesh(geometry, material)
  mesh.renderOrder = 39
  const glowMaterial = new THREE.MeshBasicMaterial({
    map: mask.texture,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    color: lyricColor(pal.highlight || pal.secondary, '#d6f8ff', 0.44)
  })
  const glow = new THREE.Mesh(geometry, glowMaterial)
  glow.renderOrder = 38
  glow.position.z = -0.008
  glow.scale.set(1.025, 1.08, 1)
  const group = new THREE.Group()
  group.renderOrder = 39
  group.position.set(0, initialY, 1.23)
  group.scale.setScalar(0.94)
  group.add(glow, mesh)

  const disposables: Array<{ dispose(): void }> = [mask.texture, material, glowMaterial, geometry]
  let transMaterial: THREE.MeshBasicMaterial | null = null
  if (transText) {
    const transMask = makeLyricMask(transText, { maxFont: 48, minFont: 24, textureScale: 0.5 })
    transMaterial = new THREE.MeshBasicMaterial({
      map: transMask.texture,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
      color: lyricColor(pal.highlight || pal.primary, '#d6f8ff', 0.44)
    })
    const transWidth = width * 0.7
    const transGeometry = new THREE.PlaneGeometry(transWidth, transWidth * MASK_ASPECT, 1, 1)
    const transMesh = new THREE.Mesh(transGeometry, transMaterial)
    transMesh.renderOrder = 39
    transMesh.position.set(0, -0.34, 0.004)
    group.add(transMesh)
    disposables.push(transMask.texture, transMaterial, transGeometry)
  }

  return {
    group, material, baseColor: material.color.clone(), glowMaterial, transMaterial,
    rowCount: mask.lines.length, textWorldH: width * MASK_ASPECT * (mask.textHeight / mask.height),
    lineIndex, text, transText, seed: Math.random() * 100, disposables
  }
}

interface MotionProfile {
  enter: number
  exit: number
  slide: number
  contextDrift: number
  glowLift: number
  floatAmp: number
}

const MOTION_PROFILES: Record<Exclude<Lyrics3dStyle, 'focus'>, MotionProfile> = {
  glass: { enter: 0.62, exit: 0.52, slide: 0.38, contextDrift: 0.066, glowLift: 1, floatAmp: 1 },
  smooth: { enter: 0.72, exit: 0.62, slide: 0.24, contextDrift: 0.03, glowLift: 0.74, floatAmp: 0.55 },
  float: { enter: 0.86, exit: 0.76, slide: 0.54, contextDrift: 0.12, glowLift: 1.16, floatAmp: 1.45 },
  quick: { enter: 0.36, exit: 0.32, slide: 0.22, contextDrift: 0.034, glowLift: 0.86, floatAmp: 0.62 },
  shine: { enter: 0.5, exit: 0.44, slide: 0.34, contextDrift: 0.052, glowLift: 1.3, floatAmp: 0.82 },
  glitch: { enter: 0.4, exit: 0.36, slide: 0.3, contextDrift: 0.045, glowLift: 1.05, floatAmp: 0.72 }
}

function motionProfile(style: Lyrics3dStyle, softness: number): MotionProfile {
  const profile = style === 'focus' ? MOTION_PROFILES.smooth : MOTION_PROFILES[style]
  const scale = THREE.MathUtils.clamp(softness / 0.72, 0.42, 1.65)
  return { ...profile, enter: profile.enter * scale, exit: profile.exit * scale, slide: profile.slide * scale }
}

function displayOffsets(mode: Lyrics3dDisplayMode): number[] {
  if (mode === 'single') return [0]
  if (mode === 'dual') return [0, 1]
  if (mode === 'triple') return [-1, 0, 1]
  return [-2, -1, 0, 1, 2]
}

function contextLineOpacity(opacity: number, edgeFade: number, distance: number, maxDistance: number, upcoming: boolean): number {
  const edgeOpacity = 1 - (distance / maxDistance) * edgeFade
  const distanceOpacity = distance <= 1 ? 1 : 0.64
  return THREE.MathUtils.clamp(opacity * (upcoming ? 1.55 : 0.75) * distanceOpacity * edgeOpacity, 0.04, 0.92)
}

function lyricLineStep(spread: number, rowCount = 1, hasTranslation = false): number {
  const base = THREE.MathUtils.clamp(0.46 * spread, 0.45, 1.05)
  return rowCount === 2 ? Math.max(base, hasTranslation ? 0.88 : 0.68) : base
}

function disposeContextMesh(mesh: ContextLyricMesh | null): void {
  if (!mesh) return
  mesh.group.parent?.remove(mesh.group)
  for (const disposable of mesh.disposables) disposable.dispose()
}

function syncTextToneMapping(material: THREE.MeshBasicMaterial, lightBackground: boolean): void {
  if (material.toneMapped === !lightBackground) return
  material.toneMapped = !lightBackground
  material.needsUpdate = true
}

function applyPaletteToMesh(mesh: ActiveLyricMesh | null, pal: LyricPalette, lightBackground = false): void {
  if (!mesh) return
  const textPalette = lightBackground ? lightLyricPalette(pal) : pal
  const base = lyricColor(textPalette.primary, '#d6f8ff', lightBackground ? 0 : 0.38)
  const hi = lyricColor(textPalette.highlight || textPalette.primary, '#fff0b8', lightBackground ? 0 : 0.48)
  const u = mesh.data.textMat.uniforms
  u.uLightTheme.value = lightBackground ? 1 : 0
  mesh.data.accentMat.uniforms.uColor.value.copy(lightBackground ? base.clone().convertLinearToSRGB() : base)
  u.uBaseColor.value.copy(base)
  u.uHiColor.value.copy(hi)
  u.uGlowColor.value.copy(lyricColor(lightBackground ? textPalette.secondary : pal.glowColor || pal.secondary, '#9cffdf', lightBackground ? 0 : 0.36))
  u.uSolarColor.value.copy(lightBackground ? hi : lyricColor(pal.highlight || pal.secondary || pal.primary, '#fff0b8', 0.5))
  mesh.data.glowMat.color.copy(lyricColor(pal.glowColor || pal.secondary, '#9cffdf', 0.36))
  mesh.data.sparkMat.uniforms.uColor.value.copy(lyricColor(pal.highlight || pal.secondary || pal.primary, '#fff0b8', 0.46))
  mesh.data.sunMat.color.copy(lyricColor(pal.highlight || pal.secondary || pal.primary, '#fff0b8', 0.5))
  if (mesh.data.transMat) {
    mesh.data.transMat.color.copy(lightBackground ? base : lyricColor(pal.highlight || pal.primary, '#d6f8ff', 0.44))
    syncTextToneMapping(mesh.data.transMat, lightBackground)
  }
}

function applyPaletteToContext(mesh: ContextLyricMesh, pal: LyricPalette, lightBackground: boolean): void {
  const textPalette = lightBackground ? lightLyricPalette(pal) : pal
  mesh.baseColor.copy(lyricColor(textPalette.primary, '#d6f8ff', lightBackground ? 0 : 0.38))
  mesh.material.color.copy(mesh.baseColor)
  syncTextToneMapping(mesh.material, lightBackground)
  mesh.glowMaterial.color.copy(lyricColor(pal.highlight || pal.secondary, '#d6f8ff', 0.44))
  mesh.transMaterial?.color.copy(lyricColor(lightBackground ? textPalette.primary : pal.highlight || pal.primary, '#d6f8ff', lightBackground ? 0 : 0.44))
  if (mesh.transMaterial) syncTextToneMapping(mesh.transMaterial, lightBackground)
}

function disposeMesh(mesh: ActiveLyricMesh | null): void {
  if (!mesh) return
  mesh.group.parent?.remove(mesh.group)
  for (const d of mesh.data.disposables) d.dispose()
}

export function StageLyrics3D({ lightBackground = false }: { lightBackground?: boolean }) {
  const lightBackgroundRef = useRef(lightBackground)
  lightBackgroundRef.current = lightBackground
  const reducedMotion = useReducedMotion()
  const rootRef = useRef<THREE.Group>(null)
  const glassBackdropRef = useRef<StageGlassBackdrop | null>(null)
  const glassCaptureAtRef = useRef(-Infinity)
  const riverRef = useRef<ReturnType<typeof createLyricStarRiver> | null>(null)
  const motionTimeRef = useRef(0)
  const playbackLightRef = useRef(usePlayerStore.getState().status === 'playing' ? 1 : 0)
  const currentRef = useRef<ActiveLyricMesh | null>(null)
  const contextRef = useRef(new Map<number, ContextLyricMesh>())
  const outgoingRef = useRef<ActiveLyricMesh[]>([])
  const previousIndexRef = useRef(-1)
  const scrollIndexRef = useRef<number | null>(null)
  const scrollVelocityRef = useRef(0)
  const lineStepRef = useRef(0)
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
  const rootWorldPositionRef = useRef(new THREE.Vector3())

  const dpr = useThree((s) => s.viewport.dpr)
  const uPixel = useMemo(() => ({ value: 1 }), [])
  useEffect(() => {
    uPixel.value = dpr
  }, [dpr, uPixel])

  // 星河跨切行复用；只释放私有几何和材质，共享星点纹理留给缓存管理。
  useEffect(() => {
    const river = createLyricStarRiver(uPixel)
    rootRef.current?.add(river)
    riverRef.current = river
    return () => {
      river.parent?.remove(river)
      river.geometry.dispose()
      river.material.dispose()
      riverRef.current = null
    }
  }, [uPixel])

  const currentIndex = useLyricsStore((s) => s.currentIndex)
  const lines = useLyricsStore((s) => s.lines)
  const wordLines = useLyricsStore((s) => s.wordLines)
  const translation = useLyricsStore((s) => s.translation)
  const showTranslation = useSettingsStore((s) => s.lyricsShowTranslation)
  const displayMode = useSettingsStore((s) => s.lyrics3d.displayMode)
  const selectedStyle = useSettingsStore((s) => s.lyrics3dStyle)
  const contextSpread = useSettingsStore((s) => s.lyrics3d.contextSpread)
  const fontFamily = useSettingsStore((s) => s.fontFamily)
  const fontFamilyCjk = useSettingsStore((s) => s.fontFamilyCjk)
  const lyrics3dFontFamily = useSettingsStore((s) => s.lyrics3dFontFamily)
  const lyrics3dFontFamilyCjk = useSettingsStore((s) => s.lyrics3dFontFamilyCjk)
  const coverUrl = usePlayerStore((s) => s.currentTrack?.cover)
  const coverPalette = useCoverLyricPalette(coverUrl)

  // 切换样式立即重播入场，让当前歌词即可展示差异，不必等下一句。
  useEffect(() => {
    const current = currentRef.current
    if (current) {
      current.age = 0
      current.entryOpacity = current.data.textMat.uniforms.uOpacity.value
      current.entryScale = current.group.scale.x
    }
  }, [selectedStyle])

  // 与聚焦歌词使用同一封面调色板，异步切歌由 hook 丢弃过期结果。
  useEffect(() => {
    palRef.current = coverPalette
    sunColorRef.current.copy(lyricColor(coverPalette.glowColor || coverPalette.secondary || coverPalette.primary, '#ffe6a4', 0.44))
    sunHotColorRef.current.copy(lyricColor(coverPalette.highlight || coverPalette.primary, '#fff4cc', 0.54))
    applyPaletteToMesh(currentRef.current, coverPalette, lightBackgroundRef.current)
    for (const mesh of outgoingRef.current) applyPaletteToMesh(mesh, coverPalette, lightBackgroundRef.current)
    for (const mesh of contextRef.current.values()) applyPaletteToContext(mesh, coverPalette, lightBackgroundRef.current)
  }, [coverPalette])

  // 字体设置变化时先清缓存；下方 mesh effect 同时依赖这些字段，当前行会立即重建。
  useEffect(() => {
    invalidateLyricFontCache()
  }, [fontFamily, fontFamilyCjk, lyrics3dFontFamily, lyrics3dFontFamilyCjk])

  // 切行时旧行进入轨道；同一句的翻译、时间或字体更新只原位重建。
  const text = currentIndex >= 0 ? (lines[currentIndex]?.text ?? '').trim() : ''
  const transText = showTranslation ? translation[currentIndex]?.text?.trim() || undefined : undefined
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const jumped = previousIndexRef.current >= 0 && Math.abs(currentIndex - previousIndexRef.current) > 1
    if (scrollIndexRef.current === null || jumped) {
      scrollIndexRef.current = currentIndex
      scrollVelocityRef.current = 0
    }
    const movingForward = previousIndexRef.current < 0 || currentIndex >= previousIndexRef.current
    const entryDirection = movingForward ? -1 : 1
    const sameLine = currentRef.current?.lineIndex === currentIndex
    const replacementState = sameLine && currentRef.current
      ? {
          position: currentRef.current.group.position.clone(),
          scale: currentRef.current.group.scale.x,
          opacity: currentRef.current.data.textMat.uniforms.uOpacity.value
        }
      : null
    if (jumped) {
      for (const mesh of outgoingRef.current) disposeMesh(mesh)
      outgoingRef.current = []
    }
    if (currentRef.current) {
      if (jumped || sameLine) {
        disposeMesh(currentRef.current)
        currentRef.current = null
      } else {
        currentRef.current.age = 0
        currentRef.current.exitDirection = movingForward ? 1 : -1
        currentRef.current.exitStartX = currentRef.current.group.position.x
        currentRef.current.exitStartZ = currentRef.current.group.position.z
        currentRef.current.exitStartScale = currentRef.current.group.scale.x
        currentRef.current.exitStartOpacity = currentRef.current.data.textMat.uniforms.uOpacity.value
        outgoingRef.current.push(currentRef.current)
        currentRef.current = null
      }
    }
    const existingContext = contextRef.current.get(currentIndex)
    const incomingState = existingContext && !jumped && !sameLine
      ? {
          position: existingContext.group.position.clone(),
          scale: existingContext.group.scale.x,
          opacity: existingContext.material.opacity
        }
      : null
    if (existingContext) {
      disposeContextMesh(existingContext)
      contextRef.current.delete(currentIndex)
    }
    previousIndexRef.current = currentIndex
    if (text) {
      const mesh = buildLyricMesh(
        text,
        transText,
        palRef.current,
        wordLines[currentIndex],
        uPixel,
        currentIndex,
        entryDirection,
        lyricLineStep(useSettingsStore.getState().lyrics3d.contextSpread)
      )
      applyPaletteToMesh(mesh, palRef.current, lightBackgroundRef.current)
      const start = replacementState ?? incomingState
      if (start) {
        mesh.group.position.copy(start.position)
        mesh.group.scale.setScalar(start.scale)
        mesh.entryOpacity = start.opacity
        mesh.entryScale = start.scale
        mesh.data.textMat.uniforms.uOpacity.value = start.opacity
        mesh.data.readabilityMat.opacity = start.opacity * 0.72 * (lightBackgroundRef.current ? 0.12 : 1)
        if (mesh.data.transMat) mesh.data.transMat.opacity = start.opacity * 0.62
      }
      if (replacementState) mesh.age = motionProfile(useSettingsStore.getState().lyrics3dStyle, useSettingsStore.getState().lyrics3d.motionSoftness).enter
      root.add(mesh.group)
      currentRef.current = mesh
    }
  }, [
    currentIndex,
    text,
    transText,
    wordLines,
    uPixel,
    fontFamily,
    fontFamilyCjk,
    lyrics3dFontFamily,
    lyrics3dFontFamilyCjk
  ])

  // 根据单/双/三/电影模式维护上下文行；复用仍在窗口内的 mesh，保证轨道连续滚动。
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const step = lyricLineStep(contextSpread, currentRef.current?.data.rowCount, !!transText)
    const wanted = new Set(
      displayOffsets(displayMode)
        .map((offset) => currentIndex + offset)
        .filter((lineIndex) => lineIndex >= 0 && lineIndex < lines.length && lineIndex !== currentIndex)
    )

    for (const [lineIndex, mesh] of contextRef.current) {
      const lineText = (lines[lineIndex]?.text ?? '').trim()
      const lineTrans = showTranslation ? translation[lineIndex]?.text?.trim() || '' : ''
      if (!wanted.has(lineIndex) || mesh.text !== lineText || mesh.transText !== lineTrans) {
        disposeContextMesh(mesh)
        contextRef.current.delete(lineIndex)
      }
    }

    for (const lineIndex of wanted) {
      if (contextRef.current.has(lineIndex)) continue
      const lineText = (lines[lineIndex]?.text ?? '').trim()
      if (!lineText) continue
      const lineTrans = showTranslation ? translation[lineIndex]?.text?.trim() || '' : ''
      const delta = lineIndex - currentIndex
      const initialY = 0.18 - delta * step
      const mesh = buildContextLyricMesh(lineText, lineTrans, palRef.current, lineIndex, initialY)
      applyPaletteToContext(mesh, palRef.current, lightBackgroundRef.current)
      contextRef.current.set(lineIndex, mesh)
      root.add(mesh.group)
    }
  }, [
    currentIndex,
    lines,
    translation,
    showTranslation,
    displayMode,
    contextSpread,
    transText,
    fontFamily,
    fontFamilyCjk,
    lyrics3dFontFamily,
    lyrics3dFontFamilyCjk
  ])

  // 切换主题只更新已有材质，保留歌词轨道、扫光时间和纹理。
  useEffect(() => {
    const pal = palRef.current
    applyPaletteToMesh(currentRef.current, pal, lightBackground)
    for (const mesh of outgoingRef.current) applyPaletteToMesh(mesh, pal, lightBackground)
    for (const mesh of contextRef.current.values()) applyPaletteToContext(mesh, pal, lightBackground)
  }, [lightBackground])

  // 卸载清场
  useEffect(
    () => () => {
      glassBackdropRef.current?.dispose()
      glassBackdropRef.current = null
      disposeMesh(currentRef.current)
      currentRef.current = null
      for (const context of contextRef.current.values()) disposeContextMesh(context)
      contextRef.current.clear()
      for (const m of outgoingRef.current) disposeMesh(m)
      outgoingRef.current = []
    },
    []
  )

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.1)
    const playing = usePlayerStore.getState().status === 'playing'
    const lightTarget = playing ? 1 : 0
    playbackLightRef.current += (lightTarget - playbackLightRef.current)
      * (reducedMotion ? 1 : frameBlend(playing ? 0.12 : 0.075, dt))
    if (playing && !reducedMotion) motionTimeRef.current += dt
    const t = motionTimeRef.current
    const settings = useSettingsStore.getState()
    const params = settings.lyrics3d
    const style = settings.lyrics3dStyle
    const look = LYRIC_STYLE_LOOKS[style]
    const profile = motionProfile(style, params.motionSoftness)
    const visibleRows = [
      currentRef.current && { rows: currentRef.current.data.rowCount, translation: !!currentRef.current.data.transMat },
      ...outgoingRef.current.map((mesh) => ({ rows: mesh.data.rowCount, translation: !!mesh.data.transMat })),
      ...Array.from(contextRef.current.values(), (mesh) => ({ rows: mesh.rowCount, translation: !!mesh.transMaterial }))
    ]
    const targetLineStep = Math.max(
      lyricLineStep(params.contextSpread),
      ...visibleRows.filter((row) => !!row).map((row) => lyricLineStep(params.contextSpread, row!.rows, row!.translation))
    )
    lineStepRef.current = lineStepRef.current === 0
      ? targetLineStep
      : lineStepRef.current + (targetLineStep - lineStepRef.current) * frameBlend(0.12, dt)
    const lineStep = lineStepRef.current
    let trackIndex = currentIndex
    if (reducedMotion) {
      scrollIndexRef.current = currentIndex
      scrollVelocityRef.current = 0
    } else {
      const next = advanceLyricScroll(
        scrollIndexRef.current ?? currentIndex,
        scrollVelocityRef.current,
        currentIndex,
        dt,
        7.5 / Math.max(0.45, profile.enter)
      )
      trackIndex = next.position
      scrollIndexRef.current = next.position
      scrollVelocityRef.current = next.velocity
    }

    // 音频能量与节拍包络
    const bands = bandEnergiesFrom(playing ? usePlayerStore.getState()._frequencyData() : [])
    const bassSum = bands.subBass + bands.bass
    const bass01 = Math.min(1, bassSum * 0.5)
    if (bassSum > BEAT_THRESHOLD && !prevBassAboveRef.current && t - lastBeatAtRef.current > BEAT_COOLDOWN) {
      beatPulseRef.current = 1
      lastBeatAtRef.current = t
    }
    prevBassAboveRef.current = bassSum > BEAT_THRESHOLD * 0.75
    beatPulseRef.current = Math.max(0, beatPulseRef.current - dt * 3.2)
    const beatPulse = beatPulseRef.current
    energySmoothRef.current += (bands.energy - energySmoothRef.current) * frameBlend(0.06, dt)

    // 辉光驱动:glowStrength 滑块(默认 1)→ 原版 lyricGlowStrength 默认 0.5
    const lyricGlowStrength = Math.min(0.85, Math.max(0, 0.5 * params.glowStrength))
    const glowDrive = Math.min(1.7, lyricGlowStrength / 0.5) * (lightBackground ? 0.35 : 1)
    const glowBreath = lyricGlowStrength > 0 ? 0.5 + 0.5 * Math.sin(t * 1.05) : 0
    const musicBloom = Math.max(energySmoothRef.current, beatPulse * 0.1)
    const beatGlowRaw = lyricGlowStrength > 0 ? beatPulse * 1.22 : 0
    beatGlowRef.current += (beatGlowRaw - beatGlowRef.current) * frameBlend(beatGlowRaw > beatGlowRef.current ? 0.32 : 0.1, dt)
    const beatGlow = beatGlowRef.current
    let solarBloom =
      lyricGlowStrength > 0
        ? (0.18 + glowBreath * 0.16 + musicBloom * 0.9 + beatGlow * 1.18 + Math.sin(t * 0.37 + 1.2) * 0.035) * glowDrive
        : 0
    solarBloom = Math.max(0, Math.min(1.45, solarBloom))
    highBloomRef.current += (solarBloom - highBloomRef.current) * frameBlend(solarBloom > highBloomRef.current ? 0.075 : 0.05, dt)
    const solar = highBloomRef.current
    const sparksOn = lyricGlowStrength > 0.025
    const motion = reducedMotion ? 0 : params.motionIntensity

    const river = riverRef.current
    if (river) {
      const u = river.material.uniforms
      const data = currentRef.current?.data
      const ease = 1 - Math.exp(-dt * 5)
      u.uTime.value = t
      u.uBass.value = bass01
      u.uBeat.value = reducedMotion ? 0 : beatPulse
      u.uMotion.value = motion
      u.uSize.value = params.particleSize
      u.uWidth.value += (Math.min(7.2, Math.max(2.25, (data?.textWorldW ?? 3.4) * 1.12 + 0.8)) - u.uWidth.value) * ease
      u.uHeight.value += (Math.min(1.35, Math.max(0.52, (data?.textWorldH ?? 0.3) * 1.85 + 0.18)) - u.uHeight.value) * ease
      const target = data && sparksOn
        ? Math.min(0.7, (0.16 + solar * 0.18 + beatGlow * 0.1) * params.particleBrightness * glowDrive) * look.particles
        : 0
      u.uOpacity.value += (target - u.uOpacity.value) * ease
      u.uColorA.value.copy(sunColorRef.current)
      u.uColorB.value.copy(sunHotColorRef.current)
      river.geometry.setDrawRange(0, Math.round(420 * params.particleCount))
      river.visible = u.uOpacity.value > 0.005
      river.position.y = currentRef.current?.group.position.y ?? 0.18
    }

    // 视口适配:按歌词所在深度的可视宽度收缩整组,窄面板不溢出
    const root = rootRef.current
    if (root) {
      // 频谱环/音箱场景会绕镜头；歌词轨道始终朝向镜头，避免上下文背面镜像或侧视变薄。
      root.lookAt(state.camera.position)
      const cam = state.camera as THREE.PerspectiveCamera
      const distToRoot = cam.position.distanceTo(root.getWorldPosition(rootWorldPositionRef.current))
      const distToLyrics = Math.max(1.4, distToRoot - 1.46 * root.scale.z)
      const visibleH = 2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) * distToLyrics
      const visibleW = visibleH * cam.aspect
      const needW = currentRef.current ? Math.max(2.4, currentRef.current.data.textWorldW) : WORLD_W
      const offsets = displayOffsets(params.displayMode)
      const verticalSpan = (Math.max(...offsets) - Math.min(...offsets)) * lineStep + WORLD_H * 1.25
      const fit = Math.min(1, (visibleW * 0.84) / needW, (visibleH * 0.72) / verticalSpan)
      fitScaleRef.current += (fit - fitScaleRef.current) * frameBlend(fit < fitScaleRef.current ? 0.18 : 0.1, dt)
      root.scale.setScalar(Math.max(0.42, fitScaleRef.current))
    }

    // 当前行:浮入 + 呼吸漂浮 + 辉光/太阳/星点动态 + KTV 进度
    const cur = currentRef.current
    if (cur) {
      if (cur.age === 0 && style === 'quick') {
        cur.group.position.x = 1.3 * motion * cur.entryDirection
      }
      cur.age += dt
      const a0 = Math.min(1, cur.age / profile.enter)
      const a = a0 * a0 * (3 - 2 * a0)
      const d = cur.data
      const seed = cur.floatSeed
      const styleFrame = lyricStyleFrame(style, cur.age, profile.enter, t, beatPulse, motion, playing)
      d.textMat.uniforms.uTime.value = t
      d.textMat.uniforms.uSweep.value = styleFrame.sweep
      const sheenDrive = lightBackground && style === 'shine' ? Math.min(1.7, lyricGlowStrength / 0.5) : glowDrive
      d.textMat.uniforms.uSheen.value = styleFrame.sheen * sheenDrive
      d.textMat.uniforms.uGlass.value = style === 'glass' ? 1 : 0
      d.textMat.uniforms.uPlaybackLight.value = playbackLightRef.current
      d.textMat.uniforms.uPrism.value = styleFrame.prism
      d.textMat.uniforms.uGlitch.value = styleFrame.glitch
      d.accentMat.uniforms.uMode.value = look.panel
      cur.group.rotation.x = styleFrame.tiltX * cur.entryDirection
      cur.group.rotation.y = styleFrame.tiltY

      const opacity = THREE.MathUtils.clamp(
        d.textMat.uniforms.uOpacity.value
          + (cur.entryOpacity + (0.96 - cur.entryOpacity) * a - d.textMat.uniforms.uOpacity.value) * frameBlend(0.16, dt),
        0,
        1
      )
      d.textMat.uniforms.uOpacity.value = opacity
      d.accentMat.uniforms.uOpacity.value = opacity
      d.readabilityMat.opacity += (opacity * (style === 'glass' ? 0.42 : 0.9) * (lightBackground ? 0.12 : 1) - d.readabilityMat.opacity) * frameBlend(0.16, dt)
      const styledSolar = solar * look.glow
      d.textMat.uniforms.uSolar.value += (styledSolar - d.textMat.uniforms.uSolar.value) * frameBlend(0.12, dt)
      if (d.transMat) d.transMat.opacity += (opacity * (lightBackground ? 0.9 : 0.72) - d.transMat.opacity) * frameBlend(0.16, dt)

      const warmth = Math.max(0, Math.min(1, solar * 1.1))
      const glowTarget = lyricGlowStrength > 0
        ? Math.min(1.0, (0.075 + styledSolar * 0.34 + beatGlow * 0.16) * Math.min(3, glowDrive) * profile.glowLift) * look.glow
        : 0
      d.glowMat.opacity += (glowTarget - d.glowMat.opacity) * frameBlend(glowTarget > d.glowMat.opacity ? 0.095 : 0.055, dt)
      d.glowMat.color.copy(lyricColor(palRef.current.glowColor || palRef.current.secondary, '#9cffdf', 0.36)).lerp(sunHotColorRef.current, warmth)

      const sparkTarget = sparksOn ? Math.min(0.42, (0.1 + solar * 0.14 + beatGlow * 0.1) * Math.min(1.6, glowDrive)) * look.particles : 0
      const sparkOpacity = d.sparkMat.uniforms.uOpacity.value
      d.sparkMat.uniforms.uOpacity.value = sparkOpacity + (sparkTarget - sparkOpacity) * frameBlend(sparkTarget > sparkOpacity ? 0.13 : 0.075, dt)
      d.sparkMat.uniforms.uSize.value +=
        ((sparksOn ? 0.05 + solar * 0.016 + beatGlow * 0.026 + bass01 * 0.008 : 0.035) - d.sparkMat.uniforms.uSize.value) * frameBlend(0.12, dt)
      d.sparkMat.uniforms.uColor.value.copy(sunHotColorRef.current).lerp(sunColorRef.current, 0.22 + solar * 0.18)
      d.sparkMat.uniforms.uTime.value = t
      d.sparkMat.uniforms.uBass.value = bass01
      d.sparkMat.uniforms.uBeat.value = beatGlow
      d.sparks.visible = d.sparkMat.uniforms.uOpacity.value > 0.015

      const sunTarget =
        lyricGlowStrength > 0 ? Math.min(0.88, (Math.pow(Math.min(1.35, solar), 1.08) * 0.28 + beatGlow * 0.2) * Math.min(2.4, glowDrive)) * look.glow : 0
      d.sunMat.opacity += (sunTarget - d.sunMat.opacity) * frameBlend(0.055, dt)
      d.sunMat.color.copy(sunColorRef.current).lerp(sunHotColorRef.current, solar * 0.55)
      const beatScale = beatGlow * 0.24
      d.sun.scale.set(
        0.82 + solar * 0.36 + beatScale + Math.sin(t * 1.6) * solar * 0.018,
        0.6 + solar * 0.34 + beatScale * 0.72 + Math.cos(t * 1.25) * solar * 0.02,
        1
      )
      // 原版辉光随节拍偏移后回落，文字保持可读；幅度服从现有动效强度。
      const follow = beatGlow * motion
      d.glow.position.x += (Math.sin(t * 1.7 + seed) * follow * 0.1 - d.glow.position.x) * (1 - Math.exp(-dt * 9))
      d.sun.position.y += (0.02 + follow * 0.045 - d.sun.position.y) * (1 - Math.exp(-dt * 7))
      d.glow.rotation.z = Math.sin(t * 0.7 + seed) * follow * 0.045
      const floatMotion = style === 'float' ? motion : 0
      const breathe = Math.sin(t * 0.92 + seed) * 0.06 * floatMotion
      const glitchX = style === 'glitch' ? Math.sin(t * 47 + seed) * beatPulse * 0.025 * motion : 0
      const moveEase = 1 - Math.exp(-dt / Math.max(0.045, profile.slide * 0.32))
      const baseScale = cur.entryScale + (1.015 - cur.entryScale) * a
      cur.group.scale.setScalar(baseScale + breathe * a)
      cur.group.position.x += (glitchX + styleFrame.slideX * cur.entryDirection + Math.sin(t * 0.55) * 0.26 * floatMotion - cur.group.position.x) * moveEase
      cur.group.position.y = 0.18 + (trackIndex - cur.lineIndex) * lineStep
        + Math.sin(t * 0.8 + seed) * 0.04 * floatMotion
      cur.group.position.z += (1.48 + Math.cos(t * 0.65 + seed) * 0.24 * floatMotion - cur.group.position.z) * moveEase
      cur.group.rotation.z = Math.sin(t * 0.55 + seed) * 0.045 * floatMotion

      // 星点漂移完全在顶点着色器中完成，主线程不再逐帧改写 BufferAttribute。
      if (d.sparks.visible) {
        d.sparks.rotation.x = Math.sin(t * 0.12 + seed) * 0.012
      }

      // KTV 进度
      const lyrics = useLyricsStore.getState()
      const now = lyricPlaybackPosition(usePlayerStore.getState()) + lyrics.offsetSec
      if (lyrics.currentIndex >= 0) {
        d.textMat.uniforms.uElapsed.value = now - (lyrics.wordLines[lyrics.currentIndex]?.time ?? now)
        d.textMat.uniforms.uProgress.value = stageLyricProgress(now, lyrics.wordLines[lyrics.currentIndex], d.wordBoundaries)
      }
      d.accentMat.uniforms.uProgress.value = d.textMat.uniforms.uProgress.value
    }

    const maxDistance = Math.max(1, ...displayOffsets(params.displayMode).map(Math.abs))
    const contextEase = 1 - Math.exp(-dt / Math.max(0.06, profile.slide))
    for (const mesh of contextRef.current.values()) {
      const distance = Math.abs(mesh.lineIndex - currentIndex)
      const deltaIndex = mesh.lineIndex - currentIndex
      const upcoming = deltaIndex > 0
      const outgoing = outgoingRef.current.find((line) => line.lineIndex === mesh.lineIndex)
      const targetOpacity = outgoing ? 0 : contextLineOpacity(params.contextOpacity, params.edgeFade, distance, maxDistance, upcoming)
      const drift = style === 'float' ? Math.sin(t * 0.65 + mesh.seed) * 0.04 * motion : 0
      const glitch = style === 'glitch' ? Math.sin(t * 38 + mesh.seed) * 0.015 : 0
      const targetY = 0.18 + (trackIndex - mesh.lineIndex) * lineStep + drift
      const targetZ = 1.24 - distance * look.depth + (upcoming ? 0.04 : -0.08)
      const targetScale = Math.max(0.72, (upcoming ? 0.99 : 0.87) - distance * 0.055)
      mesh.material.color.copy(mesh.baseColor)
      if (!lightBackground) mesh.material.color.lerp(upcoming ? sunHotColorRef.current : PAST_LYRIC_TINT, upcoming ? 0.18 : 0.42)
      const opacityEase = outgoing ? 1 : contextEase
      mesh.material.opacity += (targetOpacity - mesh.material.opacity) * opacityEase
      const glowTarget = upcoming && distance === 1 && lyricGlowStrength > 0
        ? targetOpacity * 0.27 * glowDrive * look.glow * (0.35 + playbackLightRef.current * 0.65)
        : 0
      mesh.glowMaterial.opacity += (glowTarget - mesh.glowMaterial.opacity) * contextEase
      if (mesh.transMaterial) mesh.transMaterial.opacity += (targetOpacity * 0.62 - mesh.transMaterial.opacity) * contextEase
      mesh.group.position.x += (glitch + Math.sign(deltaIndex) * look.stagger * motion - mesh.group.position.x) * contextEase
      mesh.group.position.y = targetY
      mesh.group.position.z += (targetZ - mesh.group.position.z) * contextEase
      const scale = mesh.group.scale.x + (targetScale - mesh.group.scale.x) * contextEase
      mesh.group.scale.setScalar(scale)
      mesh.group.rotation.y = style === 'float' ? -Math.sign(deltaIndex) * 0.22 * motion : 0
      mesh.group.rotation.z = style === 'float' ? Math.sin(t * 0.4 + mesh.seed) * 0.025 * motion : 0
    }

    // 淡出行沿轨道方向离开，避免当前行与上下文像两个互不相干的层。
    for (let i = outgoingRef.current.length - 1; i >= 0; i--) {
      const m = outgoingRef.current[i]
      m.age += dt
      const a0 = Math.min(1, m.age / profile.exit)
      const a = a0 * a0 * (3 - 2 * a0)
      const context = contextRef.current.get(m.lineIndex)
      const distance = Math.abs(m.lineIndex - currentIndex)
      const targetOpacity = context
        ? contextLineOpacity(params.contextOpacity, params.edgeFade, distance, maxDistance, m.lineIndex > currentIndex)
        : 0
      const opacity = THREE.MathUtils.lerp(m.exitStartOpacity, targetOpacity, a)
      const d = m.data
      d.textMat.uniforms.uOpacity.value = opacity
      d.accentMat.uniforms.uOpacity.value = opacity * (1 - a)
      d.readabilityMat.opacity = opacity * (1 - a) * (d.textMat.uniforms.uGlass.value > 0.5 ? 0.42 : 0.9) * (lightBackground ? 0.12 : 1)
      d.textMat.uniforms.uSolar.value *= 1 - frameBlend(0.14, dt)
      d.glowMat.opacity = lyricGlowStrength > 0 ? opacity * (1 - a) * 0.08 * lyricGlowStrength * look.glow : 0
      d.sparkMat.uniforms.uOpacity.value = sparksOn ? opacity * (1 - a) * 0.24 * lyricGlowStrength * look.particles : 0
      d.sunMat.opacity = lyricGlowStrength > 0 ? opacity * (1 - a) * 0.08 * lyricGlowStrength * look.glow : 0
      if (d.transMat) d.transMat.opacity = opacity * 0.6
      m.group.position.x = m.exitStartX + (style === 'quick' ? a * m.exitDirection * 1.3 * motion : 0)
      m.group.position.y = 0.18 + (trackIndex - m.lineIndex) * lineStep
      m.group.position.z = THREE.MathUtils.lerp(m.exitStartZ, m.exitStartZ - 0.24, a)
      const contextScale = context
        ? THREE.MathUtils.clamp(context.group.scale.x * context.textWorldH / Math.max(0.01, d.textWorldH), 0.4, 1.1)
        : m.exitStartScale * 0.94
      m.group.scale.setScalar(THREE.MathUtils.lerp(m.exitStartScale, contextScale, a))
      if (a0 >= 1) {
        if (context) {
          context.material.opacity = targetOpacity
          if (context.transMaterial) context.transMaterial.opacity = targetOpacity * 0.62
        }
        disposeMesh(m)
        outgoingRef.current.splice(i, 1)
      }
    }

    const glassMeshes = [currentRef.current, ...outgoingRef.current].filter(
      (mesh): mesh is ActiveLyricMesh => !!mesh && mesh.data.textMat.uniforms.uGlass.value > 0.5
    )
    if (glassMeshes.length && rootRef.current) {
      const backdrop = glassBackdropRef.current ??= new StageGlassBackdrop()
      // 字面仍按显示器刷新率渲染；折射背景至多 30fps，避免 120fps 时每帧再绘一遍场景。
      if (state.clock.elapsedTime - glassCaptureAtRef.current >= 1 / 30) {
        backdrop.capture(state.gl, state.scene, state.camera, rootRef.current)
        glassCaptureAtRef.current = state.clock.elapsedTime
      }
      for (const mesh of glassMeshes) {
        mesh.data.textMat.uniforms.uBackdrop.value = backdrop.target.texture
        mesh.data.textMat.uniforms.uResolution.value.copy(backdrop.resolution)
      }
    } else if (glassBackdropRef.current) {
      glassBackdropRef.current.dispose()
      glassBackdropRef.current = null
      glassCaptureAtRef.current = -Infinity
    }
  })

  return <group ref={rootRef} />
}
