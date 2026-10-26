import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { cancelFrame, frame, motion, type MotionStyle, useMotionValue, useSpring, useTransform, useVelocity } from 'motion/react'
import { liquidLensGrip, liquidLiftSpring, liquidPillSpring } from '../lib/motion-presets'
import { useMotion } from '../hooks/useMotion'
import { LiquidLensRenderer, lensOutline, lensRect, rasterizeTabStrip } from '../lib/liquid-lens'
import styles from './LibraryPage.module.css'

interface TabItem<T extends string> { value: T; label: string; icon?: ReactNode }

/** 点击切换时指示器保持透镜态的时长，覆盖弹簧横移与落位回弹。 */
const TRANSIT_LIFT_MS = 260
/** 按住不动多久后浮起成透镜。 */
const HOLD_LIFT_MS = 140
/** 透镜放大倍数。 */
const LENS_MAGNIFY = 1.08
/** 静置与浮起时的斜面宽度、折射深度（占透镜高度）：静置斜面窄，只弯折边缘不碰文字；浮起后更厚。 */
const REST_LENS = { bezel: 0.1, depth: 0.04 }
const LIFT_LENS = { bezel: 0.22, depth: 0.09 }

/**
 * 流体玻璃分段控件（参照 Apple Music）：指示器按速度横向拉伸、落位过冲回弹；
 * 选中项静置时也是一片薄玻璃：原标签挖空，由 WebGL 按玻璃折射重绘，边缘斜面弯折并带彩边；
 * 按住或拖动时浮起成更厚的凸透镜并放大；拿不到 WebGL 时退回清晰的 DOM 副本。
 */
export function LibraryTabs<T extends string>({ items, value, onChange }: {
  items: TabItem<T>[]
  value: T
  onChange(value: T): void
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const gesture = useRef<{ pointer: number; start: number; startY: number; index: number; moved: boolean } | null>(null)
  const suppressClick = useRef(false)
  const holdTimer = useRef<number>()
  const transitTimer = useRef<number>()
  const measured = useRef(false)
  const rootHeight = useRef(0)
  const rootWidth = useRef(0)
  const rimId = useId()
  const syncHole = useRef<() => void>()
  const lastValue = useRef(value)
  const [ready, setReady] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [holding, setHolding] = useState(false)
  const [overflowing, setOverflowing] = useState(false)
  const [glFailed, setGlFailed] = useState(false)
  const lensRef = useRef<HTMLSpanElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // 渲染器跟随 canvas 复用：同一 canvas 上的 WebGL 上下文一旦释放就拿不回来，效果重跑时不能重建。
  const rendererRef = useRef<{ canvas: HTMLCanvasElement; renderer: LiquidLensRenderer } | null>(null)
  // 父组件每次渲染都会新建 items，按内容签名触发标签贴图重画。
  const itemsKey = items.map(item => `${item.value}:${item.label}`).join('|')
  const reducedMotion = !useMotion('indicatorMotion')

  const targetX = useMotionValue(0)
  const targetWidth = useMotionValue(0)
  const liftTarget = useMotionValue(0)
  // 静置玻璃：标签贴图就绪后才接管选中项，避免挖空后贴图未到时选中文字消失一帧。
  const rest = useMotionValue(0)
  const flowXTarget = useMotionValue(0)
  const flowYTarget = useMotionValue(0)
  const x = useSpring(targetX, liquidPillSpring)
  const width = useSpring(targetWidth, liquidPillSpring)
  const lift = useSpring(liftTarget, liquidLiftSpring)
  const flowX = useSpring(flowXTarget, liquidLiftSpring)
  const flowY = useSpring(flowYTarget, liquidLiftSpring)
  const velocity = useVelocity(x)
  // 横移越快越拉长变扁，减速撞停时速度反向，形成液滴碰撞回弹。
  const stretch = useTransform(velocity, v => reducedMotion ? 0 : Math.min(Math.abs(v) / 2600, 0.3))
  const scaleX = useTransform(() => 1 + stretch.get() + lift.get() * 0.3)
  const scaleY = useTransform(() => 1 - stretch.get() * 0.4 + lift.get() * 0.42)
  const outline = useTransform(() => lensOutline(
    { left: 0, top: 0, width: width.get() * scaleX.get(), height: (rootHeight.current - 6) * scaleY.get() },
    flowX.get(), flowY.get(), scaleX.get(), scaleY.get(),
  ))
  const lensClip = useTransform(outline, path => `path('${path}')`)
  const glass = useTransform(() => Math.max(lift.get(), rest.get()))
  // 玻璃接管后磨砂指示器退场，静置也是透明玻璃；玻璃不可用（减弱动效）时仍由指示器表示选中。
  const pillOpacity = useTransform(glass, g => 1 - g)
  const lensCopyX = useTransform(x, v => -v)
  // 透镜外形会被拉伸，副本反向缩放抵消，保证透镜内文字始终等比放大。
  const magnify = useTransform(lift, l => 1 + l * (LENS_MAGNIFY - 1))
  const lensCopyScaleX = useTransform(() => magnify.get() / scaleX.get())
  const lensCopyScaleY = useTransform(() => magnify.get() / scaleY.get())
  const lensCopyOrigin = useTransform(() => `${x.get() + width.get() / 2}px 50%`)

  function buttons() { return Array.from(rootRef.current?.querySelectorAll<HTMLButtonElement>(':scope > button') ?? []) }
  function place(left: number, w: number, immediate = false) {
    targetX.set(left)
    targetWidth.set(w)
    if (immediate || reducedMotion) { x.jump(left); width.jump(w) }
  }
  function measure(index: number) {
    const button = buttons()[index]
    if (!button) return
    place(button.offsetLeft, button.offsetWidth, !measured.current)
    if (!measured.current) { measured.current = true; setReady(true) }
  }
  function setLifted(on: boolean, byPress = false) {
    setHolding(on && byPress)
    flowXTarget.set(on && byPress && !reducedMotion ? liquidLensGrip.x : 0)
    flowYTarget.set(on && byPress && !reducedMotion ? liquidLensGrip.y : 0)
    liftTarget.set(on && !reducedMotion ? 1 : 0)
    if (reducedMotion) lift.jump(0)
  }
  function nearest(clientX: number) {
    let index = 0
    let distance = Infinity
    buttons().forEach((button, i) => {
      const rect = button.getBoundingClientRect()
      const next = Math.abs(clientX - rect.left - rect.width / 2)
      if (next < distance) { distance = next; index = i }
    })
    return index
  }
  /** 拖动时指示器中心跟随指针，宽度在相邻两项之间插值，悬停在两项中间时横跨二者。 */
  function follow(clientX: number) {
    const root = rootRef.current
    const list = buttons()
    if (!root || !list.length) return 0
    const centers = list.map(button => button.offsetLeft + button.offsetWidth / 2)
    const pointer = Math.max(centers[0], Math.min(centers[centers.length - 1], clientX - root.getBoundingClientRect().left + root.scrollLeft))
    let i = 0
    while (i < centers.length - 2 && pointer > centers[i + 1]) i++
    const span = (centers[i + 1] ?? centers[i]) - centers[i]
    const t = span > 0 ? (pointer - centers[i]) / span : 0
    const w = list[i].offsetWidth + ((list[i + 1]?.offsetWidth ?? list[i].offsetWidth) - list[i].offsetWidth) * t
    place(pointer - w / 2, w)
    return t < 0.5 ? i : Math.min(i + 1, list.length - 1)
  }
  function endGesture() {
    window.clearTimeout(holdTimer.current)
    gesture.current = null
    setDragging(false)
    setLifted(false)
  }
  function resetGesture() {
    endGesture()
    measure(items.findIndex(item => item.value === value))
  }

  useEffect(() => {
    const update = () => {
      measure(items.findIndex(item => item.value === value))
      for (const button of buttons()) button.style.setProperty('--btn-left', `${button.offsetLeft}px`)
      const root = rootRef.current
      if (root) { rootHeight.current = root.clientHeight; rootWidth.current = root.scrollWidth; setOverflowing(root.scrollWidth > root.clientWidth + 1) }
      // 静置玻璃常驻挖空，轨道尺寸变了要按新尺寸重做遮罩，否则超出旧遮罩的标签会被裁掉。
      if (syncHole.current) frame.render(syncHole.current)
    }
    update()
    const observer = new ResizeObserver(update)
    if (rootRef.current) observer.observe(rootRef.current)
    for (const button of buttons()) observer.observe(button)
    return () => observer.disconnect()
  }, [items, value, reducedMotion])

  useEffect(() => {
    if (!reducedMotion) return
    rest.set(0)
    window.clearTimeout(holdTimer.current)
    window.clearTimeout(transitTimer.current)
    liftTarget.set(0)
    lift.jump(0)
    flowXTarget.set(0)
    flowYTarget.set(0)
    flowX.jump(0)
    flowY.jump(0)
  }, [reducedMotion])

  // 点击/键盘切换：横移途中短暂浮起成透镜，落位后再沉回。
  useEffect(() => {
    if (lastValue.current === value) return
    lastValue.current = value
    if (gesture.current || reducedMotion) return
    setLifted(true)
    window.clearTimeout(transitTimer.current)
    transitTimer.current = window.setTimeout(() => { if (!gesture.current) setLifted(false) }, TRANSIT_LIFT_MS)
  }, [value])

  useEffect(() => () => { window.clearTimeout(holdTimer.current); window.clearTimeout(transitTimer.current) }, [])

  // 把透镜位置同步成 CSS 变量，供真实标签按透镜范围挖空；静置玻璃也挖空，透镜消失时洞随之收拢。
  // 多个弹簧值同帧变化只合并写一次；高度取缓存值，避免写样式后读布局逼出整页同步重排。
  useEffect(() => {
    let holeOpen = true
    const sync = () => {
      const root = rootRef.current
      if (!root) return
      const hole = glass.get() > 0.01 ? glass.get() : 0
      // 洞已收拢且仍收拢时不再改变量，普通横移不触发标签的 mask 重算。
      if (!hole && !holeOpen) return
      holeOpen = hole > 0
      if (!hole) { root.style.setProperty('--lens-mask', 'none'); return }
      const rect = lensRect(x.get(), width.get(), 3, rootHeight.current - 6, scaleX.get() * hole, scaleY.get() * hole)
      const path = lensOutline(rect, flowX.get(), flowY.get())
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${rootWidth.current}" height="${rootHeight.current}"><path fill="white" fill-rule="evenodd" d="M0,0H${rootWidth.current}V${rootHeight.current}H0Z${path}"/></svg>`
      root.style.setProperty('--lens-mask', `url("data:image/svg+xml,${encodeURIComponent(svg)}")`)
      root.style.setProperty('--lens-mask-size', `${rootWidth.current}px ${rootHeight.current}px`)
    }
    syncHole.current = sync
    const schedule = () => frame.render(sync)
    const stops = [x, width, scaleX, scaleY, glass, flowX, flowY].map(value => value.on('change', schedule))
    sync()
    return () => { stops.forEach(stop => stop()); cancelFrame(sync) }
  }, [])

  // WebGL 透镜：标签条预先画成贴图，布局、主题或字体变化时重画；弹簧值变化时同帧合并重绘一次，透镜消失时不画。
  useEffect(() => {
    const root = rootRef.current
    const canvas = canvasRef.current
    if (!ready || reducedMotion || glFailed || !root || !canvas) return
    if (rendererRef.current?.canvas !== canvas) {
      const created = LiquidLensRenderer.create(canvas)
      rendererRef.current = created ? { canvas, renderer: created } : null
    }
    const renderer = rendererRef.current?.renderer
    if (!renderer) { setGlFailed(true); return }
    rest.set(0)
    let version = 0
    let disposed = false
    let lastPalette = ''
    const paletteKey = () => {
      const style = getComputedStyle(root)
      return `${lensRef.current ? getComputedStyle(lensRef.current).color : '#fff'}|${style.getPropertyValue('--sm-bg-base')}|${style.backgroundColor}`
    }
    const draw = () => {
      if (disposed || glass.get() < 0.01) return
      const rect = lensRect(x.get(), width.get(), 3, rootHeight.current - 6, scaleX.get(), scaleY.get())
      const l = lift.get()
      renderer.render({
        ...rect, magnify: magnify.get(),
        bezel: rect.height * (REST_LENS.bezel + (LIFT_LENS.bezel - REST_LENS.bezel) * l),
        depth: rect.height * (REST_LENS.depth + (LIFT_LENS.depth - REST_LENS.depth) * l),
        flowX: flowX.get(), flowY: flowY.get(),
      }, window.devicePixelRatio || 1)
    }
    const rebuild = async () => {
      const current = ++version
      const color = lensRef.current ? getComputedStyle(lensRef.current).color : '#fff'
      lastPalette = paletteKey()
      const strip = await rasterizeTabStrip(root, buttons(), color, (window.devicePixelRatio || 1) * LENS_MAGNIFY)
      if (disposed || current !== version || !strip) return
      renderer.setStrip(strip.canvas, strip.width, strip.height, strip.backdrop)
      rest.set(1)
      draw()
    }
    const schedule = () => frame.render(draw)
    const stops = [x, width, scaleX, scaleY, glass, flowX, flowY].map(value => value.on('change', schedule))
    const resize = new ResizeObserver(() => void rebuild())
    resize.observe(root)
    // 文字色和底色共同决定色散合成；主题变化时同步更新，避免浅底黑字留下暗边。
    const theme = new MutationObserver(() => {
      if (paletteKey() !== lastPalette) void rebuild()
    })
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-accent', 'style'] })
    const onLost = (event: Event) => { event.preventDefault(); setGlFailed(true) }
    canvas.addEventListener('webglcontextlost', onLost)
    void rebuild()
    void document.fonts?.ready.then(() => void rebuild())
    return () => {
      disposed = true
      rest.set(0)
      stops.forEach(stop => stop())
      cancelFrame(draw)
      resize.disconnect()
      theme.disconnect()
      canvas.removeEventListener('webglcontextlost', onLost)
    }
  }, [ready, reducedMotion, glFailed, itemsKey])

  // WebGL 不可用时 DOM 副本同步渲染，可直接作为静置玻璃。
  useEffect(() => { if (glFailed && !reducedMotion) rest.set(1) }, [glFailed, reducedMotion])

  const activeIndex = items.findIndex(item => item.value === value)
  const content = (item: TabItem<T>) => <>
    {item.icon && <span className={styles.subTabIcon}>{item.icon}</span>}
    <span>{item.label}</span>
  </>

  return <div
    ref={rootRef}
    className={`${styles.subTabs} no-drag`}
    role="group"
    aria-label="我的库分类"
    data-arrow-navigation
    data-ready={ready}
    data-dragging={dragging}
    data-holding={holding}
    data-overflowing={overflowing}
    onPointerDown={event => {
      if (event.button !== 0) return
      suppressClick.current = false
      const index = nearest(event.clientX)
      gesture.current = { pointer: event.pointerId, start: event.clientX, startY: event.clientY, index, moved: false }
      event.currentTarget.setPointerCapture(event.pointerId)
      window.clearTimeout(transitTimer.current)
      // 按在当前项上立即浮起，按在其他项上稍等片刻，避免普通点击闪一下透镜。
      if (index === activeIndex) setLifted(true, true)
      else holdTimer.current = window.setTimeout(() => { if (gesture.current) setLifted(true, true) }, HOLD_LIFT_MS)
    }}
    onPointerMove={event => {
      const current = gesture.current
      if (!current || current.pointer !== event.pointerId) return
      if (!current.moved && Math.abs(event.clientX - current.start) >= 6) {
        window.clearTimeout(holdTimer.current)
        current.moved = true; setDragging(true); setLifted(true, true)
      }
      if (!reducedMotion && liftTarget.get() > 0) {
        const root = event.currentTarget
        const lag = event.clientX - root.getBoundingClientRect().left + root.scrollLeft - x.get() - width.get() / 2
        flowXTarget.set(Math.max(-1, Math.min(1, liquidLensGrip.x + lag / liquidLensGrip.travel)))
        flowYTarget.set(Math.max(-1, Math.min(1, liquidLensGrip.y + (event.clientY - current.startY) / liquidLensGrip.travel)))
      }
      if (!current.moved) return
      current.index = follow(event.clientX)
      if (overflowing) buttons()[current.index]?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' })
    }}
    onPointerUp={event => {
      const current = gesture.current
      if (!current || current.pointer !== event.pointerId) return
      suppressClick.current = current.moved
      const index = current.moved ? current.index : nearest(event.clientX)
      endGesture()
      if (items[index]) { measure(index); onChange(items[index].value); buttons()[index]?.focus({ preventScroll: true }) }
    }}
    onPointerCancel={resetGesture}
    onLostPointerCapture={() => { if (gesture.current) resetGesture() }}
    onClickCapture={event => {
      if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false }
    }}
  >
    {ready && <motion.span
      className={styles.tabPill}
      aria-hidden="true"
      style={{ x, width, scaleX, scaleY, opacity: pillOpacity }}
    />}
    {items.map((item, index) => <button
      key={item.value}
      type="button"
      className={`${styles.subTab} ${value === item.value ? styles.subTabActive : ''}`}
      aria-pressed={value === item.value}
      onClick={() => onChange(item.value)}
      onKeyDown={event => {
        if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
        const next = event.key === 'ArrowRight' ? (index + 1) % items.length
          : event.key === 'ArrowLeft' ? (index - 1 + items.length) % items.length
            : event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : -1
        if (next < 0) return
        event.preventDefault()
        onChange(items[next].value)
        buttons()[next]?.focus()
      }}
    >{content(item)}</button>)}
    {ready && !reducedMotion && <motion.span
      ref={lensRef}
      className={styles.tabLens}
      aria-hidden="true"
      style={{ x, width, scaleX, scaleY, opacity: glass, '--lift': lift } as MotionStyle}
    >
      <motion.span className={styles.tabLensClip} style={{ clipPath: lensClip }}>
        {!glFailed && <canvas ref={canvasRef} className={styles.tabLensCanvas} />}
        {glFailed && <motion.span className={styles.tabLensCopy} style={{ x: lensCopyX, scaleX: lensCopyScaleX, scaleY: lensCopyScaleY, transformOrigin: lensCopyOrigin }}>
          {items.map(item => <span key={item.value} className={styles.subTab}>{content(item)}</span>)}
        </motion.span>}
      </motion.span>
      <svg className={styles.tabLensRim} width="100%" height="100%">
        <defs><linearGradient id={rimId} x1="0" y1="0" x2="0" y2="1" gradientUnits="objectBoundingBox">
          <stop offset="0" stopColor="white" stopOpacity="0.5" />
          <stop offset="0.45" stopColor="white" stopOpacity="0.06" />
          <stop offset="1" stopColor="white" stopOpacity="0.2" />
        </linearGradient></defs>
        <motion.path d={outline} fill="none" stroke={`url(#${rimId})`} strokeWidth="1" vectorEffect="non-scaling-stroke" />
      </svg>
    </motion.span>}
  </div>
}
