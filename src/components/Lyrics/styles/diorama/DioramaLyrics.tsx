import { fitLyricFontScale } from '../../../../lib/lyric-font-sizing'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { indexForPosition, useLyricsStore } from '../../../../stores/lyrics'
import { useSettingsStore } from '../../../../stores/settings'
import { useAmbientStore } from '../../../../stores/ambient'
import { useLyricStyleTuning } from '../../../../stores/lyric-styles'
import { readLyricFrame, subscribeLyricFrames, type LyricFrame } from '../../../../lib/lyric-frame-clock'
import { lyricLineDwellSec } from '../../../../lib/lyric-tempo'
import { buildStyleWords, seededRandom, seedFromText } from '../../../../lib/lyric-style-layouts'
import { printedGlyphs } from '../../../../lib/fume-collage'
import { mixRgb, parseCssColor, rgbCss, type Rgb } from '../../../../lib/canvas-color'
import { cameraAt, fitDistance, lineYaw, pathPoint, revealFraction, rippleState } from '../../../../lib/diorama-path'
import { useBeatState } from '../shared'
import styles from './DioramaLyrics.module.css'

/**
 * 镜台：歌词立在一条蜿蜒穿过雾中的路径上，镜头沿路径飞行，每句一个电影化取景（正面、仰拍、环绕、俯拍），
 * 换句时一条弧线飞到下一句（参考 Folia 同名样式重写）。字面板用 Canvas 栅格化，暗/亮两张贴图按演唱进度柔边揭示；
 * 脚下是一面暗色水镜，倒映当前几句并随拍泛起涟漪；周围漂浮着光尘。只在帧时钟推送时渲染，暂停即停。
 */
const SERIF = "'Songti SC', 'STSong', 'Noto Serif CJK SC', 'Source Han Serif SC', 'Noto Serif SC', serif"
const WARM: Rgb = [255, 244, 226]
/** 水面在当前句中心下方多远：贴近字脚，倒影才能和字同框。 */
const GROUND_Y = -0.6
/** 镜头注视点下移，字落在画面中上部，下方留给倒影。 */
const LOOK_DROP = 0.3
const WINDOW_BEHIND = 3
const WINDOW_AHEAD = 4
const TEXT_PX = 128
const FOV = 50
/** 字身（一个字高）的世界高度；面板四周另留发光余量。 */
const GLYPH_HEIGHT = 0.66

interface DioramaTuning {
  distance: number
  ripples: boolean
  dust: boolean
  serif: boolean
}

interface LineMesh {
  mesh: THREE.Mesh
  material: THREE.ShaderMaterial
  /** 水面倒影：与正面共用贴图，上下翻转 */
  mirror: THREE.Mesh
  mirrorMaterial: THREE.ShaderMaterial
  textures: THREE.Texture[]
  /** 每个非空白字右缘在面板里的横向比例 */
  edges: number[]
  /** 字面（不含发光余量）的世界宽度，用于取景 */
  width: number
  /** 平滑后实际显示的正面/倒影透明度；负数表示刚建好、直接取目标值 */
  shown: number
  mirrorShown: number
}

const VERTEX = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`
// 揭示线按约半个字宽羽化，演唱处有一道淡淡的高光；mirror 为 1 时是倒影：贴近水线最亮、向下淡出并随波轻晃。
const FRAGMENT = `
uniform sampler2D dimMap;
uniform sampler2D litMap;
uniform float reveal;
uniform float opacity;
uniform float litAll;
uniform float feather;
uniform float mirror;
uniform float wave;
varying vec2 vUv;
void main() {
  vec2 uv = vUv;
  float fade = 1.0;
  if (mirror > 0.5) {
    uv.x += sin(uv.y * 36.0 + wave * 2.4) * 0.0022;
    fade = (1.0 - smoothstep(0.2, 0.62, uv.y)) * 0.22;
  }
  vec4 dim = texture2D(dimMap, uv);
  vec4 lit = texture2D(litMap, uv);
  float k = max(litAll, 1.0 - smoothstep(reveal - feather, reveal + feather, uv.x));
  vec4 color = mix(dim, lit, k);
  float edge = (1.0 - litAll) * step(0.001, reveal) * (1.0 - step(0.999, reveal));
  float band = edge * exp(-pow((uv.x - reveal) / max(feather, 0.0001), 2.0));
  color.rgb += lit.rgb * band * 0.22;
  gl_FragColor = vec4(color.rgb, color.a * opacity * fade);
}
`
const WATER_FRAGMENT = `
uniform vec3 tint;
uniform vec3 glow;
varying vec2 vUv;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float floorA = 0.5 * (1.0 - smoothstep(0.1, 1.0, r));
  float pool = exp(-r * r * 22.0);
  gl_FragColor = vec4(mix(tint, glow, pool * 0.5), max(floorA, pool * 0.3));
}
`

/** 光尘用的圆形柔光点贴图（默认的方形点在高 DPR 下像坏点）。 */
function dustSprite(): THREE.Texture {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 64
  const ctx = canvas.getContext('2d')!
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
  gradient.addColorStop(0, 'rgba(255,255,255,1)')
  gradient.addColorStop(0.35, 'rgba(255,255,255,0.45)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 64, 64)
  return new THREE.CanvasTexture(canvas)
}

/** 一阶指数逼近：按真实帧间隔走，帧率不同观感一致。 */
const approach = (current: number, target: number, dt: number, tau: number) => current + (target - current) * (1 - Math.exp(-dt / tau))

const smoothStep = (t: number) => { const k = Math.min(1, Math.max(0, t)); return k * k * (3 - 2 * k) }

/** 把一句字栅格化成暗、亮两张贴图，并记下每个字右缘的位置。 */
function rasterLine(text: string, family: string, weight: number, accent: Rgb): { dim: HTMLCanvasElement; lit: HTMLCanvasElement; edges: number[]; aspect: number; textFraction: number; glyphFraction: number } {
  const probe = document.createElement('canvas').getContext('2d')!
  probe.font = `${weight} ${TEXT_PX}px ${family}`
  const chars = Array.from(text)
  // 余量要盖住最宽一层发光，否则光晕在贴图边缘被切成方框。
  const pad = TEXT_PX * 0.6
  let x = 0
  const rightEdges: number[] = []
  for (const char of chars) {
    x += probe.measureText(char).width
    if (!/\s/.test(char)) rightEdges.push(x)
  }
  // 贴图宽度不超过 4096：过长的句子整体缩小字号。
  const scale = Math.min(1, (4096 - pad * 2) / Math.max(1, x))
  const width = Math.ceil(x * scale + pad * 2)
  const height = Math.ceil(TEXT_PX * 1.3 + pad * 2)
  const make = (paint: (ctx: CanvasRenderingContext2D) => void) => {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')!
    ctx.font = `${weight} ${TEXT_PX * scale}px ${family}`
    ctx.textBaseline = 'middle'
    paint(ctx)
    return canvas
  }
  const dim = make(ctx => {
    ctx.fillStyle = 'rgba(236, 232, 248, 0.34)'
    ctx.fillText(text, pad, height / 2)
  })
  // 亮字两层光：一层宽而淡的氛围光、一层贴字的轮廓光，再压一层实字，比单层大光晕干净。
  const lit = make(ctx => {
    ctx.fillStyle = rgbCss(WARM)
    ctx.shadowColor = rgbCss(accent, 0.38)
    ctx.shadowBlur = TEXT_PX * scale * 0.42
    ctx.fillText(text, pad, height / 2)
    ctx.shadowColor = rgbCss(mixRgb(accent, WARM, 0.35), 0.7)
    ctx.shadowBlur = TEXT_PX * scale * 0.1
    ctx.fillText(text, pad, height / 2)
    ctx.shadowBlur = 0
    ctx.fillText(text, pad, height / 2)
  })
  return {
    dim, lit, edges: rightEdges.map(edge => (pad + edge * scale) / width), aspect: width / height,
    textFraction: (x * scale) / width, glyphFraction: (TEXT_PX * scale) / height,
  }
}

function disposeLine(world: THREE.Scene, line: LineMesh) {
  world.remove(line.mesh, line.mirror)
  line.mesh.geometry.dispose()
  line.material.dispose()
  line.mirrorMaterial.dispose()
  line.textures.forEach(texture => texture.dispose())
}

/** 静态签名用：各面板当前的揭示状态。 */
function uniformsKey(lines: Map<number, LineMesh>): string {
  let key = ''
  for (const [i, line] of lines) {
    const u = line.material.uniforms
    key += `${i}:${u.reveal.value}:${u.litAll.value}:${u.opacity.value.toFixed(3)};`
  }
  return key
}

export function DioramaLyrics({ preview = false }: { preview?: boolean }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const accentProbe = useRef<HTMLSpanElement>(null)
  const accent2Probe = useRef<HTMLSpanElement>(null)
  const trackKey = useLyricsStore(state => state.trackKey)
  const lines = useLyricsStore(state => state.lines)
  const wordLines = useLyricsStore(state => state.wordLines)
  const translations = useLyricsStore(state => state.translation)
  const currentIndex = useLyricsStore(state => state.currentIndex)
  const showTranslation = useSettingsStore(state => state.lyricsShowTranslation)
  const fontScale = useSettingsStore(state => state.lyricsFontScale)
  const wordMotionEnabled = useSettingsStore(state => state.performance.lyricsWordMotion)
  const fontKey = useSettingsStore(s => [s.lyricsFontFamily, s.lyricsFontFamilyCjk, s.fontFamily, s.fontFamilyCjk].join('|'))
  const palette = useAmbientStore(state => state.palette)
  const animated = wordMotionEnabled
  const raw = useLyricStyleTuning('diorama')
  const tuning = useMemo<DioramaTuning>(() => ({
    distance: Number(raw.distance), ripples: raw.ripples === true, dust: raw.dust === true, serif: raw.font === 'serif',
  }), [raw])
  const beatState = useBeatState(animated && tuning.ripples)
  // 字体加载完成后重新栅格化：之前按回退字体画的面板会一直留在窗口里。
  const [fontsReady, setFontsReady] = useState(0)
  useEffect(() => {
    if (document.fonts?.status !== 'loading') return
    let alive = true
    void document.fonts.ready.then(() => { if (alive) setFontsReady(n => n + 1) })
    return () => { alive = false }
  }, [])
  // WebGL 建不起来或上下文丢失：退回纯文字，免得页面只剩一块底色。
  const [glFailed, setGlFailed] = useState(false)
  const [sansFamily, setSansFamily] = useState('system-ui, sans-serif')
  useEffect(() => {
    const read = () => {
      const host = rootRef.current?.parentElement
      if (host) setSansFamily(getComputedStyle(host).fontFamily || 'system-ui, sans-serif')
    }
    read()
    const frame = requestAnimationFrame(read)
    return () => cancelAnimationFrame(frame)
  }, [fontKey])
  // 默认跟随设置里的歌词字体（未设置时即界面字体）；也可单独切回宋体。
  const family = tuning.serif ? SERIF : sansFamily
  const weight = tuning.serif ? 700 : 600
  const seed = seedFromText(trackKey ?? '')
  const translation = !preview && showTranslation && currentIndex >= 0 ? translations[currentIndex]?.text?.trim() : ''

  // three.js 场景只在挂载时建一次；歌词面板按需建、离开窗口即释放。
  const scene = useRef<{
    renderer: THREE.WebGLRenderer
    scene: THREE.Scene
    camera: THREE.PerspectiveCamera
    dust: THREE.Points
    water: THREE.Mesh
    ripples: { mesh: THREE.Mesh; born: number }[]
    lines: Map<number, LineMesh>
  } | null>(null)
  const state = useRef({ size: { width: 0, height: 0 }, toneAt: -Infinity, accent: [255, 190, 230] as Rgb, field: [8, 9, 18] as Rgb, lastBeat: -1, rippleCursor: 0, meshKey: '', signature: '', built: 0,
    /** 画面时间：按真实帧间隔推进、缓慢校准到播放时间，吸收采样抖动 */
    clock: Number.NaN, lastNow: 0, zoom: 0, water: null as [number, number, number] | null, words: new Map<number, ReturnType<typeof buildStyleWords>>() })
  const latest = useRef({ lines, wordLines, currentIndex, tuning, animated, family, weight, seed, fontScale, preview, beatState, fontsReady })
  latest.current = { lines, wordLines, currentIndex, tuning, animated, family, weight, seed, fontScale, preview, beatState, fontsReady }

  const clearLines = () => {
    const three = scene.current
    if (!three) return
    for (const line of three.lines.values()) disposeLine(three.scene, line)
    three.lines.clear()
  }

  const draw = useRef<(frame: LyricFrame, force?: boolean) => void>(() => {})
  draw.current = (frame: LyricFrame, force = false) => {
    const three = scene.current
    const s = state.current
    const L = latest.current
    if (!three || !s.size.width || !s.size.height) return
    if (frame.now - s.toneAt > 400) {
      s.toneAt = frame.now
      s.accent = parseCssColor(accentProbe.current ? getComputedStyle(accentProbe.current).color : '', s.accent)
      const accent2 = parseCssColor(accent2Probe.current ? getComputedStyle(accent2Probe.current).color : '', [40, 40, 90])
      s.field = mixRgb(accent2, [4, 5, 12], 0.16)
      const field = new THREE.Color(`rgb(${s.field.join(',')})`)
      three.scene.background = field
      ;(three.scene.fog as THREE.Fog).color = field
      ;(three.dust.material as THREE.PointsMaterial).color = new THREE.Color(`rgb(${mixRgb(s.accent, WARM, 0.5).join(',')})`)
      const water = (three.water.material as THREE.ShaderMaterial).uniforms
      ;(water.tint.value as THREE.Color).set(`rgb(${mixRgb(s.field, [0, 0, 0], 0.4).join(',')})`)
      ;(water.glow.value as THREE.Color).set(`rgb(${mixRgb(s.accent, s.field, 0.45).join(',')})`)
      for (const ripple of three.ripples) (ripple.mesh.material as THREE.MeshBasicMaterial).color.set(`rgb(${mixRgb(s.accent, WARM, 0.4).join(',')})`)
    }
    // 字体或歌词变了：整批面板重建。
    const meshKey = `${L.family}|${L.weight}|${L.seed}|${L.fontsReady}`
    if (meshKey !== s.meshKey) {
      clearLines()
      s.meshKey = meshKey
    }
    const moving = L.animated
    // 画面时间与当前句都从同一个平滑时钟算：store 的 currentIndex 由宿主按约 4Hz 推进、换句会晚一点，
    // 拿它切换透明度、水面和取景会和按时间飞行的镜头错开，在换句那一刻跳一下。
    const dt = Math.min(0.1, Math.max(0, (frame.now - s.lastNow) / 1000))
    s.lastNow = frame.now
    if (!moving || !frame.running || !Number.isFinite(s.clock) || Math.abs(frame.time - s.clock) > 0.5) {
      // 拖动、换曲或暂停后重新开始：水面与字号直接到位，不从旧位置一路滑过来。
      if (Math.abs(frame.time - s.clock) > 0.5 || !Number.isFinite(s.clock)) { s.water = null; s.zoom = 0 }
      s.clock = frame.time
    } else s.clock = approach(s.clock + dt, frame.time, dt, 0.4)
    const time = s.clock
    const index = moving ? indexForPosition(L.lines, time) : L.currentIndex
    const ease = (tau: number) => moving && frame.running ? dt : tau * 50
    const lineStart = (i: number) => L.lines[i]?.time ?? 0
    const sinceSwitch = index >= 0 ? time - lineStart(index) : 0
    const lineDuration = index >= 0 ? Math.max(1, (L.lines[index + 1]?.time ?? lineStart(index) + 5) - lineStart(index)) : 5
    // 歌词面板：当前句前 3 句、后 4 句。先建面板，镜头才能按面板宽度取景。
    const focus = Math.max(0, index)
    const keep = new Set<number>()
    for (let i = focus - WINDOW_BEHIND; i <= focus + WINDOW_AHEAD; i++) {
      const text = L.lines[i]?.text.replace(/\s+/g, ' ').trim()
      if (i < 0 || !text) continue
      keep.add(i)
      let line = three.lines.get(i)
      if (!line) {
        const raster = rasterLine(text, L.family, L.weight, s.accent)
        const textures = [new THREE.CanvasTexture(raster.dim), new THREE.CanvasTexture(raster.lit)]
        textures.forEach(texture => { texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4 })
        const glyphs = Math.max(1, raster.edges.length)
        const makeMaterial = (mirror: number) => new THREE.ShaderMaterial({
          vertexShader: VERTEX, fragmentShader: FRAGMENT, transparent: true, depthWrite: false, side: mirror ? THREE.DoubleSide : THREE.FrontSide,
          uniforms: {
            dimMap: { value: textures[0] }, litMap: { value: textures[1] }, reveal: { value: 0 }, opacity: { value: 1 }, litAll: { value: 0 },
            feather: { value: raster.textFraction / glyphs * 0.32 }, mirror: { value: mirror }, wave: { value: 0 },
          },
        })
        const material = makeMaterial(0)
        const mirrorMaterial = makeMaterial(1)
        const panelHeight = GLYPH_HEIGHT / raster.glyphFraction
        const geometry = new THREE.PlaneGeometry(panelHeight * raster.aspect, panelHeight)
        const mesh = new THREE.Mesh(geometry, material)
        const mirror = new THREE.Mesh(geometry, mirrorMaterial)
        const point = pathPoint(i, L.seed)
        mesh.position.set(...point)
        mesh.rotation.y = lineYaw(i, L.seed)
        mirror.rotation.y = mesh.rotation.y
        mirror.scale.y = -1
        mirror.renderOrder = -1
        three.scene.add(mesh, mirror)
        line = { mesh, material, mirror, mirrorMaterial, textures, edges: raster.edges, width: panelHeight * raster.aspect * raster.textFraction, shown: -1, mirrorShown: -1 }
        three.lines.set(i, line)
        s.built++
      }
      const rel = i - index
      const uniforms = line.material.uniforms
      // 这里只给目标透明度，后面统一按时间平滑过去，换句不会有一帧突变。
      const anticipation = moving && L.lines[index + 1] ? smoothStep(1 - (L.lines[index + 1].time - time) / 0.6) : 0
      if (rel < 0) {
        uniforms.litAll.value = 1
        uniforms.opacity.value = 0.28
      } else if (rel > 0) {
        // 后面几句在当前句身后，只留一点淡影提示路径，免得与当前句叠字。
        uniforms.litAll.value = 0
        uniforms.reveal.value = 0
        // 镜头提前起飞时下一句先浮出来，换句那一刻不是从淡影突然亮起。
        uniforms.opacity.value = rel === 1 ? 0.15 + 0.3 * anticipation : 0.08
      } else {
        let words = s.words.get(i)
        if (!words) {
          words = buildStyleWords(L.lines[i].text, L.wordLines[i], lyricLineDwellSec(L.lines, i))
          if (s.words.size > 32) s.words.clear()
          s.words.set(i, words)
        }
        const printed = printedGlyphs(words, (time - lineStart(i)) * 1000)
        uniforms.litAll.value = 0
        uniforms.reveal.value = moving ? revealFraction(line.edges, printed) : (printed > 0 ? 1 : 0)
        // 镜头提前起飞、从本句身旁掠过时本句先退下去，免得被放大、裁在画面边上。
        uniforms.opacity.value = 1 - 0.6 * anticipation
      }
    }
    for (const [i, line] of three.lines) {
      if (keep.has(i)) continue
      disposeLine(three.scene, line)
      three.lines.delete(i)
    }

    // 先确定基础取景，再独立应用字号倍率，避免长句的退镜下限抵消字号。
    const aspect = s.size.width / s.size.height
    const fitBack = (i: number) => fitDistance((three.lines.get(i)?.width ?? 0) * 1.08, FOV, aspect)
    const lineSec = (i: number) => lineStart(i + 1) - lineStart(i)
    const pose = cameraAt(index, sinceSwitch, lineDuration, L.seed, L.tuning.distance, moving, fitBack, lineSec)
    three.camera.position.set(...pose.position)
    three.camera.lookAt(pose.target[0], pose.target[1] - LOOK_DROP, pose.target[2])
    if (pose.roll) three.camera.rotateZ(pose.roll)
    // 雾从镜头到当前句之后才开始，长句退远时当前句不被雾吃掉。
    const fog = three.scene.fog as THREE.Fog
    const reach = Math.hypot(pose.position[0] - pose.target[0], pose.position[1] - pose.target[1], pose.position[2] - pose.target[2])
    const visibleH = 2 * Math.tan(FOV * Math.PI / 360) * reach
    const zoomTarget = L.preview ? 1 : fitLyricFontScale(L.fontScale,
      { width: three.lines.get(index)?.width ?? 0, height: GLYPH_HEIGHT * 1.3 },
      { width: visibleH * aspect * 0.88, height: visibleH * 0.8 })
    // 字号倍率按当前句宽度算，换句时随镜头一起缓到新值，不在换句那一帧缩放。
    s.zoom = s.zoom > 0 ? approach(s.zoom, zoomTarget, ease(0.5), 0.5) : zoomTarget
    const zoom = Math.abs(s.zoom - zoomTarget) < 1e-4 ? zoomTarget : s.zoom
    if (three.camera.zoom !== zoom) {
      three.camera.zoom = zoom
      three.camera.updateProjectionMatrix()
    }
    fog.near = reach + 2
    fog.far = reach + 25
    // 挡在镜头与当前句之间的面板（多是上一句）按深度淡出，不糊在镜头前：比当前句近 4 以上就完全隐去。
    const forward = new THREE.Vector3(pose.target[0] - pose.position[0], pose.target[1] - pose.position[1], pose.target[2] - pose.position[2]).normalize()
    // 所有句子（含当前句）都按同一深度规则淡出，换句时不会因为换了规则突然隐去或冒出。
    for (const [i, line] of three.lines) {
      const p = line.mesh.position
      const depth = (p.x - pose.position[0]) * forward.x + (p.y - pose.position[1]) * forward.y + (p.z - pose.position[2]) * forward.z
      // 深度淡出本身随镜头连续变化，不再平滑（平滑会让掠过镜头的上一句拖着大虚影扫过画面）；只平滑按句次给的目标。
      const near = Math.min(1, Math.max(0, (depth - (reach - 4)) / 3))
      const target = line.material.uniforms.opacity.value
      line.shown = line.shown < 0 ? target : approach(line.shown, target, ease(0.22), 0.22)
      line.material.uniforms.opacity.value = line.shown * near
      // 远处几句只在镜头里留淡影，倒影再减半，不和当前句的倒影抢。
      const mirrorTarget = target * (i === index ? 1 : 0.4)
      line.mirrorShown = line.mirrorShown < 0 ? mirrorTarget : approach(line.mirrorShown, mirrorTarget, ease(0.3), 0.3)
      line.mirrorMaterial.uniforms.opacity.value = line.mirrorShown * near
    }

    // 水镜跟着当前句缓缓移过去（水面高度随之过渡）；各句倒影按同一水面翻转；随拍在脚下泛起涟漪。
    const here = pathPoint(focus, L.seed)
    const goal: [number, number, number] = [here[0], GROUND_Y + here[1], here[2]]
    const w = s.water ?? goal
    s.water = [approach(w[0], goal[0], ease(0.6), 0.6), approach(w[1], goal[1], ease(0.6), 0.6), approach(w[2], goal[2], ease(0.6), 0.6)]
    const waterY = s.water[1]
    three.water.position.set(...s.water)
    for (const line of three.lines.values()) {
      line.mirror.visible = L.tuning.ripples
      if (!L.tuning.ripples) continue
      const p = line.mesh.position
      line.mirror.position.set(p.x, 2 * waterY - p.y, p.z)
      const from = line.material.uniforms
      const to = line.mirrorMaterial.uniforms
      to.reveal.value = from.reveal.value
      to.litAll.value = from.litAll.value
      to.wave.value = moving ? time : 0
    }
    const beat = L.beatState(frame.now)
    if (moving && L.tuning.ripples && beat.count !== s.lastBeat && s.lastBeat >= 0) {
      const ripple = three.ripples[s.rippleCursor++ % three.ripples.length]
      ripple.born = time
      const jitter = seededRandom(beat.count * 3.3)
      ripple.mesh.position.set(s.water[0] + (jitter() - 0.5) * 3, waterY + 0.01, s.water[2] + (jitter() - 0.5) * 2)
    }
    s.lastBeat = beat.count
    for (const ripple of three.ripples) {
      const ripplePose = moving && L.tuning.ripples ? rippleState(time - ripple.born) : null
      ripple.mesh.visible = !!ripplePose
      if (ripplePose) {
        ripple.mesh.scale.setScalar(ripplePose.radius)
        ;(ripple.mesh.material as THREE.MeshBasicMaterial).opacity = ripplePose.opacity
      }
    }
    // 光尘跟着镜头看向的位置走，绕自身中心缓慢转，整首歌都在镜头周围。
    three.dust.visible = L.tuning.dust
    three.dust.position.set(...pose.target)
    if (moving) three.dust.rotation.y = time * 0.01
    // 静态模式（减弱动态或关闭逐字动效）下播放时帧时钟仍逐帧推送：画面没变就不重画。
    if (!moving && !force) {
      const signature = `${index}|${uniformsKey(three.lines)}|${s.field}|${s.accent}|${s.size.width}x${s.size.height}|${s.built}|${L.tuning.distance}|${L.tuning.dust}|${L.tuning.ripples}|${L.fontScale}`
      if (signature === s.signature) return
      s.signature = signature
    } else s.signature = ''
    three.renderer.render(three.scene, three.camera)
  }

  useLayoutEffect(() => {
    const root = rootRef.current
    const canvas = canvasRef.current
    if (!root || !canvas) return
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
    } catch {
      setGlFailed(true)
      return
    }
    const onLost = () => setGlFailed(true)
    canvas.addEventListener('webglcontextlost', onLost)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    const world = new THREE.Scene()
    world.fog = new THREE.Fog(0x080912, 7, 30)
    const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 80)
    // 光尘：镜头周围一团点，雾会把远处的点吃掉。
    const random = seededRandom(latest.current.seed + 9)
    const count = 1100
    const positions = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (random() - 0.5) * 30
      positions[i * 3 + 1] = (random() - 0.4) * 10
      positions[i * 3 + 2] = (random() - 0.5) * 50
    }
    const dustGeometry = new THREE.BufferGeometry()
    dustGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const dustMap = dustSprite()
    const dust = new THREE.Points(dustGeometry, new THREE.PointsMaterial({ size: 0.09, map: dustMap, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }))
    world.add(dust)
    // 水镜：中心暗、向外柔和淡出的圆面（不留硬地平线），当前句脚下有一团淡淡的光。
    const water = new THREE.Mesh(new THREE.PlaneGeometry(44, 44), new THREE.ShaderMaterial({
      vertexShader: VERTEX, fragmentShader: WATER_FRAGMENT, transparent: true, depthWrite: false,
      uniforms: { tint: { value: new THREE.Color(0x05060c) }, glow: { value: new THREE.Color(0x30284a) } },
    }))
    water.renderOrder = -2
    water.rotation.x = -Math.PI / 2
    world.add(water)
    const ripples = Array.from({ length: 6 }, () => {
      const mesh = new THREE.Mesh(new THREE.RingGeometry(0.97, 1, 96), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }))
      mesh.rotation.x = -Math.PI / 2
      mesh.visible = false
      world.add(mesh)
      return { mesh, born: -Infinity }
    })
    scene.current = { renderer, scene: world, camera, dust, water, ripples, lines: new Map() }
    state.current.toneAt = -Infinity
    const measure = () => {
      const width = root.clientWidth
      const height = root.clientHeight
      state.current.size = { width, height }
      if (!width || !height) return
      const ratio = latest.current.preview ? 0.4 : Math.min(1.5, window.devicePixelRatio || 1)
      renderer.setPixelRatio(ratio)
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      draw.current(readLyricFrame(), true)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(root)
    measure()
    const stopFrames = subscribeLyricFrames(frame => draw.current(frame))
    return () => {
      stopFrames()
      observer.disconnect()
      canvas.removeEventListener('webglcontextlost', onLost)
      clearLines()
      dustGeometry.dispose()
      ;(dust.material as THREE.Material).dispose()
      dustMap.dispose()
      water.geometry.dispose()
      ;(water.material as THREE.Material).dispose()
      ripples.forEach(({ mesh }) => { mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose() })
      renderer.dispose()
      renderer.forceContextLoss()
      scene.current = null
    }
  }, [])
  // 歌词表或主题配色变了：面板重建、颜色重读。
  useLayoutEffect(() => { clearLines(); state.current.meshKey = ''; state.current.words.clear(); state.current.water = null; state.current.zoom = 0; state.current.clock = Number.NaN }, [lines, wordLines])
  useLayoutEffect(() => { state.current.toneAt = -Infinity }, [palette])
  useEffect(() => {
    const timer = setTimeout(() => { state.current.toneAt = -Infinity; clearLines(); draw.current(readLyricFrame(), true) }, 900)
    return () => clearTimeout(timer)
  }, [palette])
  useLayoutEffect(() => { draw.current(readLyricFrame(), true) })

  return (
    <div ref={rootRef} className={styles.root} style={{ '--lyrics-font-scale': preview ? 1 : fontScale } as React.CSSProperties}>
      <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />
      {glFailed && <div className={styles.fallback} style={{ fontFamily: family }}>{currentIndex >= 0 ? lines[currentIndex]?.text : ''}</div>}
      <span ref={accentProbe} className={`${styles.probe} ${styles.probeAccent}`} aria-hidden="true" />
      <span ref={accent2Probe} className={`${styles.probe} ${styles.probeAccent2}`} aria-hidden="true" />
      <span className={styles.srOnly}>{currentIndex >= 0 ? lines[currentIndex]?.text : ''}</span>
      {translation && <div className={styles.translation} style={{ fontFamily: family }}>{translation}</div>}
    </div>
  )
}
