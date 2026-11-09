import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { queueDragFollow, queueDragLift } from '../../lib/motion-presets'
import styles from './ListReorder.module.css'

/** 按下后移动超过此距离才算拖动，否则仍是点击。 */
const DRAG_THRESHOLD = 4

export interface ListReorderState {
  from: number
  target: number
}

interface Session {
  pointerId: number
  from: number
  row: HTMLElement
  startX: number
  startY: number
  grabX: number
  grabY: number
  px: number
  py: number
  x: number
  y: number
  vx: number
  tilt: number
  lift: number
  /** 按行宽换算的浮起放大与最大倾斜：宽行的边缘位移按像素封顶，不随宽度放大。 */
  liftScale: number
  /** 上一帧的指针横坐标，用于由横向速度算倾斜。 */
  lastPx: number
  maxTilt: number
  active: boolean
  returning: boolean
  /** 拖动开始时各行相对列表的上沿与高度；设置列表行数少且不虚拟化，拖动中不会变。 */
  tops: number[]
  heights: number[]
  target: number
  /** 已提交新顺序、等它渲染出来；期间保留浮起行与让位，避免新旧顺序之间闪一帧。 */
  settling: boolean
  last: number
  raf: number
}

interface Options {
  listRef: RefObject<HTMLElement | null>
  total: number
  /** 当前顺序的标识（如各项 id 连接）；变化即视为新顺序已渲染。 */
  orderKey: string
  reducedMotion: boolean
  /** 该行能否拖起；不传时全部可拖。 */
  canDrag?(index: number): boolean
  onMove(from: number, to: number): void
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const approach = (current: number, target: number, rate: number, dt: number) => current + (target - current) * (1 - Math.exp(-rate * dt))
/** 行内控件（按钮、开关、输入框）照常点击，不触发拖动。 */
const NO_DRAG = 'button, input, select, textarea, a, [role="switch"], [data-reorder-no-drag]'

/**
 * 短列表的纵向拖动排序，手感参考播放队列：拖起的行浮起并随横向晃动轻微倾斜，其余行让位，松手回落到目标位置后再提交。
 * 行展开 `rowProps(index)`；让位过渡与被拖行留空的样式由调用方按 `data-reordering` / `data-drag-placeholder` 设置。
 * 让位距离经 CSS 变量 `--reorder-shift` 传出，调用方用 `translate` 属性应用，不与 framer 的 transform 冲突。
 */
export function useListReorder({ listRef, total, orderKey, reducedMotion, canDrag, onMove }: Options) {
  const [drag, setDrag] = useState<ListReorderState | null>(null)
  /** 刚落位的行，短暂标记用于落位反馈；key 递增让连续落到同一位置也能重播。 */
  const [landed, setLanded] = useState<{ index: number; key: number } | null>(null)
  const landedTimer = useRef(0)
  const settleTimer = useRef(0)
  const ghostRef = useRef<HTMLLIElement>(null)
  const session = useRef<Session | null>(null)
  const latest = useRef({ total, reducedMotion, canDrag, onMove })
  latest.current = { total, reducedMotion, canDrag, onMove }

  const finish = useCallback(() => {
    const s = session.current
    if (s) cancelAnimationFrame(s.raf)
    session.current = null
    const ghost = ghostRef.current
    if (ghost) {
      ghost.replaceChildren()
      ghost.style.transform = ''
    }
    setDrag(null)
  }, [])

  /** 行落到 target 时的上沿：向下移时以目标行的下沿对齐，兼容行高不一致。 */
  const slotTop = (s: Session, target: number) => target > s.from
    ? s.tops[target] + s.heights[target] - s.heights[s.from]
    : s.tops[target]

  const tick = useCallback((now: number) => {
    const s = session.current
    const list = listRef.current
    const ghost = ghostRef.current
    if (!s || !list || !ghost) return
    const reduce = latest.current.reducedMotion
    const dt = Math.min(0.05, (now - s.last) / 1000 || 1 / 60)
    s.last = now
    const rect = list.getBoundingClientRect()

    if (!s.returning) {
      // 以拖起行的中线落在哪一行的范围内决定目标位置。
      const center = s.py - s.grabY - rect.top + s.heights[s.from] / 2
      let target = s.tops.findIndex((top, index) => center < top + s.heights[index])
      if (target < 0) target = s.tops.length - 1
      target = clamp(target, 0, s.tops.length - 1)
      if (target !== s.target) {
        s.target = target
        setDrag((d) => (d && d.target !== target ? { ...d, target } : d))
      }
    }

    // 只沿纵向排序：浮起行锁在本列，横向不跟手，避免偏离左侧顺序线；横向晃动只换成轻微倾斜。
    const desiredX = s.startX - s.grabX - rect.left
    const desiredY = s.returning ? slotTop(s, s.target) : s.py - s.grabY - rect.top
    if (reduce) {
      s.x = desiredX
      s.y = desiredY
    } else {
      s.x = approach(s.x, desiredX, queueDragFollow, dt)
      s.y = approach(s.y, desiredY, queueDragFollow, dt)
    }
    s.vx = approach(s.vx, s.returning ? 0 : (s.px - s.lastPx) / dt, 18, dt)
    s.lastPx = s.px
    const leanTo = s.returning || reduce ? 0 : clamp(s.vx * 0.012, -s.maxTilt, s.maxTilt)
    s.tilt = reduce ? 0 : approach(s.tilt, leanTo, 14, dt)
    s.lift = reduce ? 1 : approach(s.lift, s.returning ? 1 : s.liftScale, 16, dt)
    ghost.style.transform = `translate(${s.x}px, ${s.y}px) rotate(${s.tilt}deg) scale(${s.lift})`

    if (s.returning && (reduce || (Math.abs(s.x - desiredX) < 0.5 && Math.abs(s.y - desiredY) < 0.5 && Math.abs(s.tilt) < 0.05))) {
      const { from, target } = s
      if (target === from) {
        finish()
        return
      }
      // 新顺序可能经宿主异步写回：先保持落位画面，顺序变化的那次渲染里再一并撤掉（见下方 layout effect）；
      // 保存失败等情况顺序不变时，超时后照常复位。
      s.settling = true
      window.clearTimeout(settleTimer.current)
      settleTimer.current = window.setTimeout(() => { if (session.current?.settling) finish() }, 400)
      latest.current.onMove(from, target)
      return
    }
    s.raf = requestAnimationFrame(tick)
  }, [finish, listRef])

  const tickRef = useRef(tick)
  tickRef.current = tick
  const loop = useCallback((now: number) => tickRef.current(now), [])

  const listeners = useRef<{ move(e: PointerEvent): void; up(e: PointerEvent): void; cancel(e: PointerEvent): void } | null>(null)
  const detach = () => {
    const l = listeners.current
    if (!l) return
    window.removeEventListener('pointermove', l.move)
    window.removeEventListener('pointerup', l.up)
    window.removeEventListener('pointercancel', l.cancel)
  }

  const release = (event: PointerEvent, cancelled: boolean) => {
    const s = session.current
    if (!s || event.pointerId !== s.pointerId) return
    detach()
    if (!s.active) {
      session.current = null
      return
    }
    // 拖动结束后吞掉紧随的 click，避免误触行内控件。
    const swallow = (e: MouseEvent) => { e.stopPropagation(); e.preventDefault() }
    window.addEventListener('click', swallow, { capture: true, once: true })
    setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0)
    if (cancelled) s.target = s.from
    s.returning = true
    setDrag((d) => (d ? { ...d, target: s.target } : d))
  }

  const move = (event: PointerEvent) => {
    const s = session.current
    if (!s || event.pointerId !== s.pointerId || s.returning) return
    s.px = event.clientX
    s.py = event.clientY
    if (s.active) return
    if (Math.hypot(event.clientX - s.startX, event.clientY - s.startY) < DRAG_THRESHOLD) return
    const list = listRef.current
    const ghost = ghostRef.current
    if (!list || !ghost) return
    const rows = Array.from(list.querySelectorAll<HTMLElement>(':scope > [data-reorder-row]'))
    if (rows.length !== latest.current.total) return
    const rect = list.getBoundingClientRect()
    s.tops = rows.map((row) => row.getBoundingClientRect().top - rect.top)
    s.heights = rows.map((row) => row.getBoundingClientRect().height)
    s.active = true
    window.getSelection()?.removeAllRanges()
    const clone = s.row.cloneNode(true) as HTMLElement
    clone.removeAttribute('data-reorder-row')
    clone.style.width = `${s.row.offsetWidth}px`
    ghost.replaceChildren(clone)
    const rowRect = s.row.getBoundingClientRect()
    // 队列行约 300px 宽，沿用其手感：放大让两侧各多出不超过 6px，倾斜让两端起伏不超过约 12px。
    const width = Math.max(1, rowRect.width)
    s.liftScale = Math.min(queueDragLift.scale, 1 + 12 / width)
    s.maxTilt = Math.min(queueDragLift.maxTilt, (Math.asin(Math.min(1, 24 / width)) * 180) / Math.PI)
    s.x = rowRect.left - rect.left
    s.y = rowRect.top - rect.top
    setDrag({ from: s.from, target: s.from })
    s.last = performance.now()
    s.raf = requestAnimationFrame(loop)
  }

  const handlers = useRef({ move, release })
  handlers.current = { move, release }
  if (!listeners.current) {
    listeners.current = {
      move: (e) => handlers.current.move(e),
      up: (e) => handlers.current.release(e, false),
      cancel: (e) => handlers.current.release(e, true),
    }
  }

  useEffect(() => () => {
    window.clearTimeout(landedTimer.current)
    window.clearTimeout(settleTimer.current)
    if (session.current) cancelAnimationFrame(session.current.raf)
    detach()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 新顺序渲染后、绘制前撤掉浮起行与让位，并标记落位的行；两者在同一帧生效，不会露出旧位置。
  useLayoutEffect(() => {
    const s = session.current
    if (!s?.settling) return
    const target = s.target
    window.clearTimeout(settleTimer.current)
    finish()
    if (latest.current.reducedMotion) return
    window.clearTimeout(landedTimer.current)
    setLanded((prev) => ({ index: target, key: (prev?.key ?? 0) + 1 }))
    landedTimer.current = window.setTimeout(() => setLanded(null), 520)
  }, [orderKey, finish])

  const onRowPointerDown = useCallback((index: number, event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || session.current || latest.current.total < 2) return
    if (latest.current.canDrag && !latest.current.canDrag(index)) return
    if ((event.target as Element).closest(NO_DRAG)) return
    const rect = event.currentTarget.getBoundingClientRect()
    session.current = {
      pointerId: event.pointerId, from: index, row: event.currentTarget,
      startX: event.clientX, startY: event.clientY, grabX: event.clientX - rect.left, grabY: event.clientY - rect.top,
      px: event.clientX, py: event.clientY, x: 0, y: 0, vx: 0, tilt: 0, lift: 1, liftScale: 1, lastPx: event.clientX, maxTilt: 0,
      active: false, returning: false, tops: [], heights: [], target: index, settling: false, last: 0, raf: 0,
    }
    const l = listeners.current!
    window.addEventListener('pointermove', l.move)
    window.addEventListener('pointerup', l.up)
    window.addEventListener('pointercancel', l.cancel)
  }, [])

  /** 拖动期间各行的让位距离：起止之间的行向空位方向让出被拖行的高度加行距。 */
  const rowShift = useCallback((index: number): number => {
    const s = session.current
    if (!drag || !s || index === drag.from || !s.tops.length) return 0
    const { from, target } = drag
    const pitch = (step: number) => s.heights[from] + Math.max(0, step)
    if (from < target && index > from && index <= target) return -pitch(s.tops[from + 1] - s.tops[from] - s.heights[from])
    if (target < from && index >= target && index < from) return pitch(s.tops[from] - s.tops[from - 1] - s.heights[from - 1])
    return 0
  }, [drag])

  /** 拖动期间每行需要的属性：让位位移与状态标记。 */
  const rowProps = useCallback((index: number, extraStyle?: CSSProperties) => ({
    'data-reorder-row': true,
    'data-reordering': drag ? true : undefined,
    'data-drag-placeholder': drag?.from === index || undefined,
    // 两个取值交替换动画名，连续落位也会重新播放。
    'data-landed': !drag && landed?.index === index ? (landed.key % 2 ? 'a' : 'b') : undefined,
    style: { ...extraStyle, ...(drag ? { '--reorder-shift': `${rowShift(index)}px` } as CSSProperties : null) },
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => onRowPointerDown(index, event),
  }), [drag, landed, onRowPointerDown, rowShift])

  /** 放进列表容器（需 position: relative）里的浮起行。 */
  const ghost = <li ref={ghostRef} className={styles.ghost} aria-hidden="true" />

  return { drag, rowProps, ghost }
}

/** 排序圆点的强度：首项实心强调色，往下逐项变浅，末项保留约三分之一。 */
export function rankStrength(index: number, total: number): CSSProperties {
  const strength = total > 1 ? 1 - (index / (total - 1)) * 0.65 : 1
  return { '--rank-strength': strength.toFixed(3) } as CSSProperties
}
