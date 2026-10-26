import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { cancelFrame, frame, motion, useMotionValue, useSpring, useTransform, useVelocity } from 'motion/react'
import { liquidPillSpring } from '../../lib/motion-presets'
import { LiquidLensRenderer, lensRect, rasterizeContent } from '../../lib/liquid-lens'
import { useMotion } from '../../hooks/useMotion'

/** 浮起时的放大量与透镜内图标的额外放大。 */
const LIFT_SCALE = 0.16
const LENS_MAGNIFY = 1.08

/**
 * 流体玻璃播放键：按下时像我的库分段透镜一样弹性浮起放大，松手果冻回弹；
 * 浮起期间图标改由 WebGL 透镜重绘，经玻璃放大、斜面弯折并带边缘镜面高光，沉回后换回 DOM 图标。
 * 归属「按压回弹」开关：关闭后没有浮起与缩放。拿不到 WebGL 时只保留浮起形变。
 */
export function LiquidPlayButton({ 'aria-label': label, loading, disabled, stopPointer, iconKey, onClick, classes, children }: {
  'aria-label': string
  /** 样式由调用方传入：本组件自己引入 PlayerBar 样式会改变打包顺序，让 .control 盖掉播放键的圆角与悬停色。 */
  classes: { button: string; iconLayer: string; lens: string; star?: string }
  loading?: boolean
  disabled?: boolean
  /** 按下事件不再冒泡（迷你播放条里冒泡会触发拖动窗口）。 */
  stopPointer?: boolean
  /** 图标内容变化（播放/暂停切换）时重画透镜贴图。 */
  iconKey: string
  onClick?(event: MouseEvent<HTMLButtonElement>): void
  children: ReactNode
}) {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<{ canvas: HTMLCanvasElement; renderer: LiquidLensRenderer } | null>(null)
  const rasterize = useRef<() => void>(() => {})
  const [glFailed, setGlFailed] = useState(false)
  const enabled = useMotion('tapFeedbackMotion')

  const liftTarget = useMotionValue(0)
  const lift = useSpring(liftTarget, liquidPillSpring)
  const velocity = useVelocity(lift)
  // 浮起时略收窄拉高、沉回时压扁铺开，像一滴液体被按下又弹起。
  const squash = useTransform(velocity, v => Math.max(-0.08, Math.min(0.08, v / 120)))
  const scaleX = useTransform(() => 1 + lift.get() * LIFT_SCALE - squash.get())
  const scaleY = useTransform(() => 1 + lift.get() * LIFT_SCALE + squash.get())
  const iconOpacity = useTransform(lift, l => 1 - Math.min(1, l * 2.5))
  const lensOpacity = useTransform(lift, l => Math.min(1, l * 2.5))

  function setLifted(on: boolean) {
    if (!enabled) return
    if (on) rasterize.current()
    liftTarget.set(on ? 1 : 0)
  }

  useEffect(() => {
    if (enabled) return
    liftTarget.set(0)
    lift.jump(0)
  }, [enabled])

  useEffect(() => {
    const button = buttonRef.current
    const canvas = canvasRef.current
    if (!enabled || glFailed || !button || !canvas) return
    if (rendererRef.current?.canvas !== canvas) {
      const created = LiquidLensRenderer.create(canvas)
      rendererRef.current = created ? { canvas, renderer: created } : null
    }
    const renderer = rendererRef.current?.renderer
    if (!renderer) { setGlFailed(true); return }
    let version = 0
    let disposed = false
    const draw = () => {
      if (disposed || lift.get() < 0.01) return
      const w = button.offsetWidth
      const h = button.offsetHeight
      const sx = scaleX.get()
      const sy = scaleY.get()
      const rect = lensRect(0, w, 0, h, sx, sy)
      renderer.render({
        ...rect,
        magnify: (sx + sy) / 2 * LENS_MAGNIFY,
        bezel: rect.height * 0.22,
        depth: rect.height * 0.09,
        rim: 0.55 * lift.get(),
      }, window.devicePixelRatio || 1)
    }
    // 只在按钮未变形时取图标位置，否则测到的是放大后的坐标。
    rasterize.current = () => {
      if (lift.get() > 0.02) return
      const current = ++version
      void rasterizeContent(button, [button], getComputedStyle(button).color, (window.devicePixelRatio || 1) * (1 + LIFT_SCALE) * LENS_MAGNIFY)
        .then(strip => {
          if (disposed || current !== version || !strip) return
          renderer.setStrip(strip.canvas, strip.width, strip.height)
          draw()
        })
    }
    const schedule = () => frame.render(draw)
    const stops = [lift, scaleX, scaleY].map(value => value.on('change', schedule))
    const onLost = (event: Event) => { event.preventDefault(); setGlFailed(true) }
    canvas.addEventListener('webglcontextlost', onLost)
    return () => {
      disposed = true
      rasterize.current = () => {}
      stops.forEach(stop => stop())
      cancelFrame(draw)
      canvas.removeEventListener('webglcontextlost', onLost)
    }
  }, [enabled, glFailed])

  // 图标切换动画结束后、且未浮起时预先画好贴图，下次按下即可直接显示。
  useEffect(() => {
    const timer = window.setTimeout(() => rasterize.current(), 400)
    return () => window.clearTimeout(timer)
  }, [iconKey, enabled, glFailed])

  return <motion.button
    ref={buttonRef}
    type="button"
    className={classes.button}
    onClick={onClick}
    title={label}
    aria-label={label}
    data-loading={loading}
    disabled={disabled}
    style={enabled ? { scaleX, scaleY } : undefined}
    onPointerEnter={() => rasterize.current()}
    onPointerDown={event => {
      if (stopPointer) event.stopPropagation()
      if (event.button === 0) setLifted(true)
    }}
    onPointerUp={() => setLifted(false)}
    onPointerLeave={() => setLifted(false)}
    onPointerCancel={() => setLifted(false)}
  >
    <motion.span className={classes.iconLayer} style={{ opacity: enabled && !glFailed ? iconOpacity : 1 }}>{children}</motion.span>
    {enabled && !glFailed && <motion.canvas ref={canvasRef} className={classes.lens} aria-hidden="true" style={{ opacity: lensOpacity }} />}
    {classes.star && <span className={classes.star} aria-hidden="true" />}
  </motion.button>
}
