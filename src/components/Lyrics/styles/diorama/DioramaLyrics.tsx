import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useLyricsStore } from '../../../../stores/lyrics'
import { useSettingsStore } from '../../../../stores/settings'
import { useAmbientStore } from '../../../../stores/ambient'
import { useLyricStyleTuning } from '../../../../stores/lyric-styles'
import { useReducedMotion } from '../../../../hooks/useReducedMotion'
import { readLyricFrame, subscribeLyricFrames, type LyricFrame } from '../../../../lib/lyric-frame-clock'
import { lyricLineDwellSec } from '../../../../lib/lyric-tempo'
import { buildStyleWords, seededRandom, seedFromText } from '../../../../lib/lyric-style-layouts'
import { printedGlyphs } from '../../../../lib/fume-article'
import { mixRgb, parseCssColor, rgbCss, type Rgb } from '../../../../lib/canvas-color'
import { cameraAt, fitDistance, lineYaw, pathPoint, revealFraction, rippleState } from '../../../../lib/diorama-path'
import { useBeatState } from '../shared'
import styles from './DioramaLyrics.module.css'

/**
 * 镜台：歌词立在一条蜿蜒穿过雾中的路径上，镜头沿路径飞行，每句一个电影化取景（正面、仰拍、环绕、俯拍），
 * 换句时一条弧线飞到下一句（参考 Folia 同名样式重写）。字面板用 Canvas 栅格化，暗/亮两张贴图按演唱进度揭示；
 * 脚下是一面暗色水镜，随拍泛起涟漪；周围漂浮着光尘。只在帧时钟推送时渲染，暂停即停。
 */
const SERIF = "'Songti SC', 'STSong', 'Noto Serif CJK SC', 'Source Han Serif SC', 'Noto Serif SC', serif"
const WARM: Rgb = [255, 244, 226]
const GROUND_Y = -2.6
const WINDOW_BEHIND = 3
const WINDOW_AHEAD = 4
const TEXT_PX = 128
const FOV = 50
const PANEL_HEIGHT = 1.25

interface DioramaTuning {
  distance: number
  ripples: boolean
  dust: boolean
  serif: boolean
}

interface LineMesh {
  mesh: THREE.Mesh
  material: THREE.ShaderMaterial
  textures: THREE.Texture[]
  /** 每个非空白字右缘在面板里的横向比例 */
  edges: number[]
  /** 面板世界宽度 */
  width: number
}

const VERTEX = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`
const FRAGMENT = `
uniform sampler2D dimMap;
uniform sampler2D litMap;
uniform float reveal;
uniform float opacity;
uniform float litAll;
varying vec2 vUv;
void main() {
  vec4 dim = texture2D(dimMap, vUv);
  vec4 lit = texture2D(litMap, vUv);
  float k = max(litAll, 1.0 - smoothstep(reveal - 0.004, reveal + 0.004, vUv.x));
  vec4 color = mix(dim, lit, k);
  gl_FragColor = vec4(color.rgb, color.a * opacity);
}
`

/** 把一句字栅格化成暗、亮两张贴图，并记下每个字右缘的位置。 */
function rasterLine(text: string, family: string, accent: Rgb): { dim: HTMLCanvasElement; lit: HTMLCanvasElement; edges: number[]; aspect: number } {
  const probe = document.createElement('canvas').getContext('2d')!
  probe.font = `700 ${TEXT_PX}px ${family}`
  const chars = Array.from(text)
  const pad = TEXT_PX * 0.4
  let x = 0
  const rightEdges: number[] = []
  for (const char of chars) {
    x += probe.measureText(char).width
    if (!/\s/.test(char)) rightEdges.push(x)
  }
  // 贴图宽度不超过 4096：过长的句子整体缩小字号。
  const scale = Math.min(1, (4096 - pad * 2) / Math.max(1, x))
  const width = Math.ceil(x * scale + pad * 2)
  const height = Math.ceil(TEXT_PX * scale * 1.5 + pad)
  const make = (paint: (ctx: CanvasRenderingContext2D) => void) => {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')!
    ctx.font = `700 ${TEXT_PX * scale}px ${family}`
    ctx.textBaseline = 'middle'
    paint(ctx)
    return canvas
  }
  const dim = make(ctx => {
    ctx.fillStyle = 'rgba(190, 200, 228, 0.42)'
    ctx.fillText(text, pad, height / 2)
  })
  const lit = make(ctx => {
    ctx.shadowColor = rgbCss(accent, 0.9)
    ctx.shadowBlur = TEXT_PX * scale * 0.35
    ctx.fillStyle = rgbCss(WARM)
    ctx.fillText(text, pad, height / 2)
    ctx.shadowBlur = 0
    ctx.fillText(text, pad, height / 2)
  })
  return { dim, lit, edges: rightEdges.map(edge => (pad + edge * scale) / width), aspect: width / height }
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
  const appFont = useSettingsStore(state => state.fontFamily)
  const lyricFont = useSettingsStore(state => state.lyricsFontFamily)
  const palette = useAmbientStore(state => state.palette)
  const reducedMotion = useReducedMotion()
  const animated = wordMotionEnabled && !reducedMotion
  const raw = useLyricStyleTuning('diorama')
  const tuning = useMemo<DioramaTuning>(() => ({
    distance: Number(raw.distance), ripples: raw.ripples === true, dust: raw.dust === true, serif: raw.serif === true,
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
  }, [appFont, lyricFont])
  const family = tuning.serif ? SERIF : sansFamily
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
  const state = useRef({ size: { width: 0, height: 0 }, toneAt: -Infinity, accent: [255, 190, 230] as Rgb, field: [8, 9, 18] as Rgb, lastBeat: -1, rippleCursor: 0, meshKey: '', signature: '', built: 0, words: new Map<number, ReturnType<typeof buildStyleWords>>() })
  const latest = useRef({ lines, wordLines, currentIndex, tuning, animated, family, seed, fontScale, preview, beatState, fontsReady })
  latest.current = { lines, wordLines, currentIndex, tuning, animated, family, seed, fontScale, preview, beatState, fontsReady }

  const clearLines = () => {
    const three = scene.current
    if (!three) return
    for (const line of three.lines.values()) {
      three.scene.remove(line.mesh)
      line.mesh.geometry.dispose()
      line.material.dispose()
      line.textures.forEach(texture => texture.dispose())
    }
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
    }
    // 字体或歌词变了：整批面板重建。
    const meshKey = `${L.family}|${L.seed}|${L.fontsReady}`
    if (meshKey !== s.meshKey) {
      clearLines()
      s.meshKey = meshKey
    }
    const moving = L.animated
    const index = L.currentIndex
    const time = frame.time
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
        const raster = rasterLine(text, L.family, s.accent)
        const textures = [new THREE.CanvasTexture(raster.dim), new THREE.CanvasTexture(raster.lit)]
        textures.forEach(texture => { texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4 })
        const material = new THREE.ShaderMaterial({
          vertexShader: VERTEX, fragmentShader: FRAGMENT, transparent: true, depthWrite: false,
          uniforms: { dimMap: { value: textures[0] }, litMap: { value: textures[1] }, reveal: { value: 0 }, opacity: { value: 1 }, litAll: { value: 0 } },
        })
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(PANEL_HEIGHT * raster.aspect, PANEL_HEIGHT), material)
        const point = pathPoint(i, L.seed)
        mesh.position.set(...point)
        mesh.rotation.y = lineYaw(i, L.seed)
        three.scene.add(mesh)
        line = { mesh, material, textures, edges: raster.edges, width: PANEL_HEIGHT * raster.aspect }
        three.lines.set(i, line)
        s.built++
      }
      const rel = i - index
      const uniforms = line.material.uniforms
      if (rel < 0) {
        uniforms.litAll.value = 1
        uniforms.opacity.value = 0.55
      } else if (rel > 0) {
        // 后面几句在当前句身后，压暗免得与当前句叠字。
        uniforms.litAll.value = 0
        uniforms.reveal.value = 0
        uniforms.opacity.value = rel === 1 ? 0.4 : 0.25
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
        uniforms.opacity.value = 1
      }
    }
    for (const [i, line] of three.lines) {
      if (keep.has(i)) continue
      three.scene.remove(line.mesh)
      line.mesh.geometry.dispose()
      line.material.dispose()
      line.textures.forEach(texture => texture.dispose())
      three.lines.delete(i)
    }

    // 字越大镜头越近；长句退到能看全整句。
    const aspect = s.size.width / s.size.height
    const fitBack = (i: number) => fitDistance(three.lines.get(i)?.width ?? 0, FOV, aspect)
    const lineSec = (i: number) => lineStart(i + 1) - lineStart(i)
    const pose = cameraAt(index, sinceSwitch, lineDuration, L.seed, L.tuning.distance / (L.preview ? 1 : Math.max(0.7, L.fontScale)), moving, fitBack, lineSec)
    three.camera.position.set(...pose.position)
    three.camera.lookAt(...pose.target)
    // 雾从镜头到当前句之后才开始，长句退远时当前句不被雾吃掉。
    const fog = three.scene.fog as THREE.Fog
    const reach = Math.hypot(pose.position[0] - pose.target[0], pose.position[1] - pose.target[1], pose.position[2] - pose.target[2])
    fog.near = reach + 2
    fog.far = reach + 25
    // 挡在镜头与当前句之间的面板（多是上一句）按深度淡出，不糊在镜头前：比当前句近 4 以上就完全隐去。
    const forward = new THREE.Vector3(pose.target[0] - pose.position[0], pose.target[1] - pose.position[1], pose.target[2] - pose.position[2]).normalize()
    for (const [i, line] of three.lines) {
      if (i === index) continue
      const p = line.mesh.position
      const depth = (p.x - pose.position[0]) * forward.x + (p.y - pose.position[1]) * forward.y + (p.z - pose.position[2]) * forward.z
      line.material.uniforms.opacity.value *= Math.min(1, Math.max(0, (depth - (reach - 4)) / 3))
    }

    // 水镜跟着当前句；随拍在脚下泛起涟漪。
    const here = pathPoint(focus, L.seed)
    three.water.position.set(here[0], GROUND_Y + here[1], here[2])
    const beat = L.beatState(frame.now)
    if (moving && L.tuning.ripples && beat.count !== s.lastBeat && s.lastBeat >= 0) {
      const ripple = three.ripples[s.rippleCursor++ % three.ripples.length]
      ripple.born = time
      const jitter = seededRandom(beat.count * 3.3)
      ripple.mesh.position.set(here[0] + (jitter() - 0.5) * 3, GROUND_Y + here[1] + 0.01, here[2] + (jitter() - 0.5) * 2)
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
      const signature = `${index}|${uniformsKey(three.lines)}|${s.field}|${s.accent}|${s.size.width}x${s.size.height}|${s.built}|${L.tuning.distance}|${L.tuning.dust}|${L.fontScale}`
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
    const count = 1600
    const positions = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (random() - 0.5) * 30
      positions[i * 3 + 1] = (random() - 0.4) * 10
      positions[i * 3 + 2] = (random() - 0.5) * 50
    }
    const dustGeometry = new THREE.BufferGeometry()
    dustGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const dust = new THREE.Points(dustGeometry, new THREE.PointsMaterial({ size: 0.05, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false }))
    world.add(dust)
    // 水镜：一面暗色平面，带极淡的同心环纹。
    const water = new THREE.Mesh(new THREE.CircleGeometry(16, 48), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45 }))
    water.rotation.x = -Math.PI / 2
    world.add(water)
    const ripples = Array.from({ length: 6 }, () => {
      const mesh = new THREE.Mesh(new THREE.RingGeometry(0.96, 1, 64), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }))
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
      water.geometry.dispose()
      ;(water.material as THREE.Material).dispose()
      ripples.forEach(({ mesh }) => { mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose() })
      renderer.dispose()
      renderer.forceContextLoss()
      scene.current = null
    }
  }, [])
  // 歌词表或主题配色变了：面板重建、颜色重读。
  useLayoutEffect(() => { clearLines(); state.current.meshKey = ''; state.current.words.clear() }, [lines, wordLines])
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
      {translation && <div className={styles.translation} style={{ fontFamily: tuning.serif ? SERIF : undefined }}>{translation}</div>}
    </div>
  )
}
