import { useEffect, useRef, useState, type ReactNode } from 'react'
import { motion, useMotionValue, useSpring, useTransform, useVelocity } from 'motion/react'
import { liquidLiftSpring, liquidPillSpring } from '../lib/motion-presets'
import { useReducedMotion } from '../hooks/useReducedMotion'
import styles from './LibraryPage.module.css'

interface TabItem<T extends string> { value: T; label: string; icon?: ReactNode }

/** 点击切换时指示器保持透镜态的时长，覆盖弹簧横移与落位回弹。 */
const TRANSIT_LIFT_MS = 260
/** 按住不动多久后浮起成透镜。 */
const HOLD_LIFT_MS = 140

/**
 * 流体玻璃分段控件（参照 Apple Music）：指示器按速度横向拉伸、落位过冲回弹；
 * 按住或拖动时浮起成凸透镜：透镜内原标签挖空，换成清晰放大的副本，只有边缘轻微模糊。
 */
export function LibraryTabs<T extends string>({ items, value, onChange }: {
  items: TabItem<T>[]
  value: T
  onChange(value: T): void
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const gesture = useRef<{ pointer: number; start: number; index: number; moved: boolean } | null>(null)
  const suppressClick = useRef(false)
  const holdTimer = useRef<number>()
  const transitTimer = useRef<number>()
  const measured = useRef(false)
  const lastValue = useRef(value)
  const [ready, setReady] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [holding, setHolding] = useState(false)
  const [overflowing, setOverflowing] = useState(false)
  const reducedMotion = useReducedMotion()

  const targetX = useMotionValue(0)
  const targetWidth = useMotionValue(0)
  const liftTarget = useMotionValue(0)
  const x = useSpring(targetX, liquidPillSpring)
  const width = useSpring(targetWidth, liquidPillSpring)
  const lift = useSpring(liftTarget, liquidLiftSpring)
  const velocity = useVelocity(x)
  // 横移越快越拉长变扁，减速撞停时速度反向，形成液滴碰撞回弹。
  const stretch = useTransform(velocity, v => reducedMotion ? 0 : Math.min(Math.abs(v) / 2600, 0.3))
  const scaleX = useTransform(() => 1 + stretch.get() + lift.get() * 0.3)
  const scaleY = useTransform(() => 1 - stretch.get() * 0.4 + lift.get() * 0.42)
  const pillOpacity = useTransform(lift, l => 1 - l)
  const lensCopyX = useTransform(x, v => -v)
  // 透镜外形会被拉伸，副本反向缩放抵消，保证透镜内文字始终等比放大。
  const magnify = useTransform(lift, l => 1 + l * 0.08)
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
      if (root) setOverflowing(root.scrollWidth > root.clientWidth + 1)
    }
    update()
    const observer = new ResizeObserver(update)
    if (rootRef.current) observer.observe(rootRef.current)
    for (const button of buttons()) observer.observe(button)
    return () => observer.disconnect()
  }, [items, value, reducedMotion])

  useEffect(() => {
    if (!reducedMotion) return
    window.clearTimeout(holdTimer.current)
    window.clearTimeout(transitTimer.current)
    liftTarget.set(0)
    lift.jump(0)
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

  // 把透镜位置同步成 CSS 变量，供真实标签按透镜范围挖空；透镜沉下时洞随之收拢。
  useEffect(() => {
    const sync = () => {
      const root = rootRef.current
      if (!root) return
      const l = lift.get()
      const hole = l > 0.01 ? l : 0
      root.style.setProperty('--lens-cx', `${x.get() + width.get() / 2}px`)
      root.style.setProperty('--lens-rx', `${width.get() * scaleX.get() / 2 * hole}px`)
      root.style.setProperty('--lens-ry', `${(root.clientHeight - 6) * scaleY.get() / 2 * hole}px`)
    }
    const stops = [x, width, scaleX, scaleY, lift].map(value => value.on('change', sync))
    sync()
    return () => stops.forEach(stop => stop())
  }, [])

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
      gesture.current = { pointer: event.pointerId, start: event.clientX, index, moved: false }
      event.currentTarget.setPointerCapture(event.pointerId)
      window.clearTimeout(transitTimer.current)
      // 按在当前项上立即浮起，按在其他项上稍等片刻，避免普通点击闪一下透镜。
      if (index === activeIndex) setLifted(true, true)
      else holdTimer.current = window.setTimeout(() => { if (gesture.current) setLifted(true, true) }, HOLD_LIFT_MS)
    }}
    onPointerMove={event => {
      const current = gesture.current
      if (!current || current.pointer !== event.pointerId) return
      if (!current.moved && Math.abs(event.clientX - current.start) < 6) return
      if (!current.moved) { current.moved = true; setDragging(true); setLifted(true, true) }
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
      className={styles.tabLens}
      aria-hidden="true"
      style={{ x, width, scaleX, scaleY, opacity: lift }}
    >
      <span className={styles.tabLensClip}>
        <motion.span className={styles.tabLensCopy} style={{ x: lensCopyX, scaleX: lensCopyScaleX, scaleY: lensCopyScaleY, transformOrigin: lensCopyOrigin }}>
          {items.map(item => <span key={item.value} className={styles.subTab}>{content(item)}</span>)}
        </motion.span>
      </span>
    </motion.span>}
  </div>
}
