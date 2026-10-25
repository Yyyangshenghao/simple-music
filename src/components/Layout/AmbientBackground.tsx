import { lazy, Suspense, useCallback, useEffect, useId, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { useSpring, useMotionValueEvent } from 'motion/react'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import { useAmbientStore } from '../../stores/ambient'
import { useVisualStore } from '../../stores/visual'
import { useSettingsStore } from '../../stores/settings'
import { usePlayerStore } from '../../stores/player'
import { solidBackgroundCss, useBackgroundStore } from '../../stores/background'
import { useLightTheme } from '../../hooks/useLightTheme'
import { gentleSpringValues } from '../../lib/motion-presets'
import { api } from '../../lib/api'
import { lumaStatsFromPixels, mediaTone, parseColor, scrimOpacity, type LumaStats } from '../../lib/theme-tone'
import styles from './AmbientBackground.module.css'

const LiquidEther = lazy(() => import('../Visualizer/LiquidEther'))

interface AmbientBackgroundProps {
  /** 为 true 时隐藏背景层（如歌词页 3D 模式打开，保证同屏只有一个全屏 WebGL）。 */
  hidden?: boolean
}

export function backgroundFileUrl(id: string): string {
  return api.url('/api/background/file', { id })
}

/** 图片/视频背景的模糊与明暗滤镜；模糊时外扩画面，避免边缘羽化露出底色。 */
function mediaStyle(blur: number, tone: string): CSSProperties | undefined {
  if (blur <= 0) return tone ? { filter: tone } : undefined
  const bleed = blur * 2
  return { filter: `blur(${blur}px) ${tone}`.trim(), top: -bleed, left: -bleed, width: `calc(100% + ${bleed * 2}px)`, height: `calc(100% + ${bleed * 2}px)` }
}

/** 尚未测得亮度时按中等亮度处理：亮图不会先闪一下刺眼的原图，暗图也只多压一点。 */
const UNKNOWN_LUMA: LumaStats = { mean: 0.5, high: 0.6, low: 0.4 }
const VIDEO_SAMPLE_MS = 3000

/** 缩到 32×18 统计亮度；跨源被拒（canvas 污染）等异常时返回 null，保留上一次结果。 */
function sampleLuma(source: HTMLImageElement | HTMLVideoElement): LumaStats | null {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 32
    canvas.height = 18
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.drawImage(source, 0, 0, 32, 18)
    return lumaStatsFromPixels(ctx.getImageData(0, 0, 32, 18).data)
  } catch {
    return null
  }
}

/** 视频播放时每隔几秒取一帧，让遮罩跟上明暗变化；暂停时只在停下的那帧取一次。 */
function useVideoLuma(ref: RefObject<HTMLVideoElement | null>, onLuma: (stats: LumaStats) => void, stopped: boolean): void {
  useEffect(() => {
    const video = ref.current
    if (!video) return
    const sample = () => { if (video.readyState >= 2) { const stats = sampleLuma(video); if (stats) onLuma(stats) } }
    video.addEventListener('loadeddata', sample)
    video.addEventListener('seeked', sample)
    sample()
    const timer = stopped ? 0 : window.setInterval(sample, VIDEO_SAMPLE_MS)
    return () => {
      video.removeEventListener('loadeddata', sample)
      video.removeEventListener('seeked', sample)
      if (timer) window.clearInterval(timer)
    }
  }, [ref, onLuma, stopped])
}

/** 视频背景：窗口隐藏/失焦、节能档或减弱动态时停在当前帧，省下逐帧解码与玻璃面板重采样。 */
function VideoBackground({ src, blur, tone, paused, onLuma }: { src: string; blur: number; tone: string; paused: boolean; onLuma: (stats: LumaStats) => void }) {
  const ref = useRef<HTMLVideoElement>(null)
  const [inactive, setInactive] = useState(() => typeof document !== 'undefined' && (document.hidden || !document.hasFocus()))
  useEffect(() => {
    const sync = () => setInactive(document.hidden || !document.hasFocus())
    document.addEventListener('visibilitychange', sync)
    window.addEventListener('focus', sync)
    window.addEventListener('blur', sync)
    return () => {
      document.removeEventListener('visibilitychange', sync)
      window.removeEventListener('focus', sync)
      window.removeEventListener('blur', sync)
    }
  }, [])
  const stopped = paused || inactive
  useEffect(() => {
    const video = ref.current
    if (!video) return
    if (stopped) video.pause()
    else void video.play().catch(() => {})
  }, [stopped, src])
  useVideoLuma(ref, onLuma, stopped)
  // crossOrigin 让 canvas 能读帧取亮度；本地 API 已对渲染层放行 CORS。
  return <video ref={ref} className={styles.media} style={mediaStyle(blur, tone)} src={src} crossOrigin="anonymous" muted loop playsInline preload="auto" aria-hidden="true" />
}

/** 全局背景层：流体（封面/自定义配色）、自定义图片、视频与静态底色。播放缓动的高频 state 隔离在本组件内。 */
export function AmbientBackground({ hidden }: AmbientBackgroundProps) {
  const coverPalette = useAmbientStore((s) => s.palette)
  const background = useBackgroundStore()
  const light = useLightTheme()
  const palette = background.fluidPalette === 'custom' ? background.fluidColors : coverPalette
  const performanceMode = useVisualStore((s) => s.performanceMode)
  const bgFluidMotion = useSettingsStore((s) => s.performance.bgFluidMotion)
  const bgPointerMotion = useSettingsStore((s) => s.performance.bgPointerMotion)
  const reduceTransparency = useSettingsStore((s) => s.performance.reduceTransparency)
  const reducedMotion = useReducedMotion()
  const playing = usePlayerStore((s) => s.status === 'playing')
  const fluidEnabled = !hidden && background.kind === 'fluid' && bgFluidMotion && !reduceTransparency && !reducedMotion && performanceMode !== 'eco'

  // 播放/暂停背景强度缓动：单弹簧 0↔1，避免流体参数跳变
  const playSpring = useSpring(playing ? 1 : 0, gentleSpringValues)
  const [playAmount, setPlayAmount] = useState(playing ? 1 : 0)
  useEffect(() => {
    if (fluidEnabled) playSpring.set(playing ? 1 : 0)
    else playSpring.jump(playing ? 1 : 0)
  }, [playing, playSpring, fluidEnabled])
  useMotionValueEvent(playSpring, 'change', (v) => setPlayAmount(v))

  // 图片/视频的亮度统计按文件记录，换文件时回到未知值重新测。
  const media = background.kind === 'image' ? background.image : background.kind === 'video' ? background.video : null
  const [mediaLuma, setMediaLuma] = useState<{ id: string; stats: LumaStats } | null>(null)
  const mediaId = media?.id ?? ''
  const liftFilterId = `sm-bg-lift${useId().replace(/:/g, '')}`
  const reportLuma = useCallback((stats: LumaStats) => setMediaLuma({ id: mediaId, stats }), [mediaId])

  // 隐藏时释放 WebGL 上下文与纹理，避免与歌词场景同时占用显存。
  if (hidden) return null

  if (media) {
    const { scrim, gamma, saturate } = mediaTone(mediaLuma?.id === media.id ? mediaLuma.stats : UNKNOWN_LUMA, light, background.mediaDim)
    const tone = { scrim, filter: gamma < 1 ? `url(#${liftFilterId}) saturate(${saturate.toFixed(3)})` : '' }
    return (
      <div className={styles.background} data-background={media.kind}>
        {/* gamma 提亮只能用 SVG 滤镜表达；sRGB 插值与 CSS 遮罩的混合空间一致 */}
        {gamma < 1 && <svg className={styles.filterDefs} aria-hidden="true">
          <filter id={liftFilterId} colorInterpolationFilters="sRGB">
            <feComponentTransfer>
              <feFuncR type="gamma" exponent={gamma} />
              <feFuncG type="gamma" exponent={gamma} />
              <feFuncB type="gamma" exponent={gamma} />
            </feComponentTransfer>
          </filter>
        </svg>}
        {media.kind === 'image'
          ? <img className={styles.media} style={mediaStyle(background.mediaBlur, tone.filter)} src={backgroundFileUrl(media.id)} crossOrigin="anonymous" alt="" aria-hidden="true" draggable={false}
            onLoad={(event) => { const next = sampleLuma(event.currentTarget); if (next) reportLuma(next) }} />
          : <VideoBackground src={backgroundFileUrl(media.id)} blur={background.mediaBlur} tone={tone.filter} paused={reducedMotion || performanceMode === 'eco'} onLuma={reportLuma} />}
        <div className={styles.mediaDim} style={{ opacity: tone.scrim }} aria-hidden="true" />
      </div>
    )
  }

  if (background.kind === 'solid') {
    // 预设已按主题色调筛过；自定义颜色可能与主题相反，同样叠一层自适应遮罩保证文字可读。
    const rgb = background.solid === 'custom' ? parseColor(background.solidColor) : null
    const luma = rgb ? (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255 : 0
    return (
      <div className={styles.background} data-background="solid" style={{ background: solidBackgroundCss(background, light) }}>
        {rgb && <div className={styles.mediaDim} style={{ opacity: scrimOpacity({ mean: luma, high: luma, low: luma }, light, 0) }} aria-hidden="true" />}
      </div>
    )
  }

  // 自定义配色只作用于背景层，界面强调色仍跟随封面。
  const fallbackStyle = background.fluidPalette === 'custom'
    ? { '--ambient-1': palette[0], '--ambient-2': palette[1], '--ambient-3': palette[2] } as CSSProperties
    : undefined

  return (
    <div className={styles.background} data-background="fluid" style={fallbackStyle}>
      {!fluidEnabled ? (
        <div className={styles.auroraFallback} aria-hidden="true" />
      ) : (
        <Suspense fallback={<div className={styles.auroraFallback} aria-hidden="true" />}>
          <LiquidEther
            colors={palette}
            pointerInteraction={bgPointerMotion}
            mouseForce={12}
            cursorSize={80}
            resolution={performanceMode === 'balanced' ? 0.4 : 0.5}
            // 氛围背景是缓慢漂移的模糊流体,16 次 Poisson 迭代与 30fps 观感无差,
            // 相比默认 32 次@刷新率(ProMotion 下 120fps)GPU 负载降约一个数量级
            iterationsPoisson={16}
            fpsCap={playing ? 30 : 20}
            // 交互提帧:鼠标划过流体时临时升到 60fps 保证跟手,静置 2 秒回落省电
            interactFpsCap={60}
            autoDemo={true}
            autoSpeed={0.25 + 0.2 * playAmount}
            autoIntensity={1.2 + 0.6 * playAmount}
            autoResumeDelay={2000}
          />
        </Suspense>
      )}
    </div>
  )
}
