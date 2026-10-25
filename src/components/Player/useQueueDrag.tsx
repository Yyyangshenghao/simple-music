import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { motion } from 'motion/react'
import { queueDragFollow, queueDragLift, queueShredStrip } from '../../lib/motion-presets'
import styles from './QueuePanel.module.css'
import { useMotion } from '../../hooks/useMotion'

/** 按下后移动超过此距离才算拖动，否则仍是点击。 */
const DRAG_THRESHOLD = 4
/** 指针进入列表上下边缘此范围内自动滚动，越靠边越快。 */
const EDGE = 32
const MAX_SCROLL_STEP = 10
/** 碎纸条数（横切成条）。 */
const STRIPS = 6

export interface QueueDragState {
  from: number
  target: number
  overSlit: boolean
  canShred: boolean
}

interface Shred { id: number; node: HTMLElement; left: number; top: number; width: number; height: number }

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
  active: boolean
  returning: boolean
  slotY: number
  target: number
  overSlit: boolean
  canShred: boolean
  last: number
  raf: number
}

interface Options {
  panelRef: RefObject<HTMLElement | null>
  listRef: RefObject<HTMLElement | null>
  slitRef: RefObject<HTMLElement | null>
  total: number
  rowHeight: number
  reducedMotion: boolean
  canShred(displayIndex: number): boolean
  onMove(from: number, to: number): void
  onShred(displayIndex: number): void
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const approach = (current: number, target: number, rate: number, dt: number) => current + (target - current) * (1 - Math.exp(-rate * dt))

/**
 * 播放队列指针拖动（参考 React Bits Shredder）：拖起的行浮起并随横向速度倾斜，其余行让位；
 * 拖到列表边缘自动滚动；拖进底部碎纸口松手即移除并播放碎纸条落下。逐帧位置直接写 DOM，不触发重渲染。
 */
export function useQueueDrag({ panelRef, listRef, slitRef, total, rowHeight, reducedMotion, canShred, onMove, onShred }: Options) {
  const [drag, setDrag] = useState<QueueDragState | null>(null)
  const [shreds, setShreds] = useState<Shred[]>([])
  const ghostRef = useRef<HTMLDivElement>(null)
  const session = useRef<Session | null>(null)
  const latest = useRef({ total, rowHeight, reducedMotion, canShred, onMove, onShred })
  latest.current = { total, rowHeight, reducedMotion, canShred, onMove, onShred }
  const shredId = useRef(0)

  const contentTop = (list: HTMLElement) => {
    const inner = list.firstElementChild as HTMLElement | null
    return (inner ?? list).getBoundingClientRect().top
  }

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

  const tick = useCallback((now: number) => {
    const s = session.current
    const panel = panelRef.current
    const list = listRef.current
    const ghost = ghostRef.current
    if (!s || !panel || !list || !ghost) return
    const { rowHeight: row, total: count, reducedMotion: reduce } = latest.current
    const dt = Math.min(0.05, (now - s.last) / 1000 || 1 / 60)
    s.last = now
    const panelRect = panel.getBoundingClientRect()
    const listRect = list.getBoundingClientRect()

    if (!s.returning) {
      // 碎纸口在面板右缘：指针向右拖进竖缝才算，上下拖动排序不会误入。
      const slitLeft = slitRef.current?.getBoundingClientRect().left ?? Infinity
      const wasOver = s.overSlit
      s.overSlit = s.px >= slitLeft - 6
      // 自动滚动：拖到列表上下边缘时滚动。
      const up = listRect.top + EDGE - s.py
      const down = s.py - (listRect.bottom - EDGE)
      if (up > 0) list.scrollTop -= Math.ceil(MAX_SCROLL_STEP * Math.min(1, up / EDGE))
      else if (down > 0) list.scrollTop += Math.ceil(MAX_SCROLL_STEP * Math.min(1, down / EDGE))
      const centerY = s.py - s.grabY + row / 2 - contentTop(list)
      const target = s.overSlit ? s.from : clamp(Math.floor(centerY / row), 0, count - 1)
      if (target !== s.target || s.overSlit !== wasOver) {
        s.target = target
        setDrag((d) => (d && (d.target !== target || d.overSlit !== s.overSlit) ? { ...d, target, overSlit: s.overSlit } : d))
      }
    }

    const desiredX = s.returning ? s.startX - s.grabX - panelRect.left : s.px - s.grabX - panelRect.left
    const desiredY = s.returning ? s.slotY - panelRect.top : s.py - s.grabY - panelRect.top
    const prevX = s.x
    if (reduce) {
      s.x = desiredX
      s.y = desiredY
    } else {
      s.x = approach(s.x, desiredX, queueDragFollow, dt)
      s.y = approach(s.y, desiredY, queueDragFollow, dt)
    }
    s.vx = approach(s.vx, (s.x - prevX) / dt, 18, dt)
    const leanTo = s.returning || reduce ? 0 : clamp(s.vx * 0.012, -queueDragLift.maxTilt, queueDragLift.maxTilt)
    s.tilt = reduce ? 0 : approach(s.tilt, leanTo, 14, dt)
    s.lift = reduce ? 1 : approach(s.lift, s.returning ? 1 : queueDragLift.scale, 16, dt)
    // 悬在碎纸口上方：卡片随碎纸口轻微震颤，提示松手会被吃进去。
    const jitter = s.overSlit && s.canShred && !reduce ? Math.sin(now * 0.14) * 0.6 : 0
    ghost.style.transform = `translate(${s.x + jitter}px, ${s.y}px) rotate(${s.tilt}deg) scale(${s.lift})`

    if (s.returning && (reduce || (Math.abs(s.x - desiredX) < 0.5 && Math.abs(s.y - desiredY) < 0.5 && Math.abs(s.tilt) < 0.05))) {
      const { from, target } = s
      finish()
      if (target !== from) latest.current.onMove(from, target)
      return
    }
    s.raf = requestAnimationFrame(tick)
  }, [finish, listRef, panelRef, slitRef])

  const tickRef = useRef(tick)
  tickRef.current = tick
  const loop = useCallback((now: number) => tickRef.current(now), [])

  // 窗口级指针监听：行在虚拟列表滚动中可能被卸载，不能依赖行上的指针捕获。监听函数只创建一次。
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
    // 拖动结束后吞掉紧随的 click，避免误触发切歌。
    const swallow = (e: MouseEvent) => { e.stopPropagation(); e.preventDefault() }
    window.addEventListener('click', swallow, { capture: true, once: true })
    setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0)

    const list = listRef.current
    const ghost = ghostRef.current
    if (!cancelled && s.overSlit && s.canShred) {
      const node = ghost?.firstElementChild as HTMLElement | null | undefined
      if (node && !latest.current.reducedMotion) {
        setShreds((items) => [...items, {
          id: ++shredId.current, node, left: s.x, top: s.y,
          width: s.row.offsetWidth, height: s.row.offsetHeight,
        }])
      }
      const from = s.from
      finish()
      latest.current.onShred(from)
      return
    }
    if (cancelled || !list) s.target = s.from
    s.returning = true
    s.slotY = list ? contentTop(list) + s.target * latest.current.rowHeight : s.startY - s.grabY
    setDrag((d) => (d ? { ...d, target: s.target, overSlit: false } : d))
  }

  const move = (event: PointerEvent) => {
    const s = session.current
    if (!s || event.pointerId !== s.pointerId || s.returning) return
    s.px = event.clientX
    s.py = event.clientY
    if (s.active) return
    if (Math.hypot(event.clientX - s.startX, event.clientY - s.startY) < DRAG_THRESHOLD) return
    const panel = panelRef.current
    const ghost = ghostRef.current
    if (!panel || !ghost) return
    s.active = true
    window.getSelection()?.removeAllRanges()
    const clone = s.row.cloneNode(true) as HTMLElement
    clone.style.width = `${s.row.offsetWidth}px`
    ghost.replaceChildren(clone)
    const panelRect = panel.getBoundingClientRect()
    const rowRect = s.row.getBoundingClientRect()
    s.x = rowRect.left - panelRect.left
    s.y = rowRect.top - panelRect.top
    s.canShred = latest.current.canShred(s.from)
    setDrag({ from: s.from, target: s.from, overSlit: false, canShred: s.canShred })
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
    if (session.current) cancelAnimationFrame(session.current.raf)
    detach()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onRowPointerDown = useCallback((displayIndex: number, event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || session.current) return
    if (latest.current.total < 2 && !latest.current.canShred(displayIndex)) return
    if ((event.target as Element).closest('[data-queue-no-drag]')) return
    const rect = event.currentTarget.getBoundingClientRect()
    session.current = {
      pointerId: event.pointerId, from: displayIndex, row: event.currentTarget,
      startX: event.clientX, startY: event.clientY, grabX: event.clientX - rect.left, grabY: event.clientY - rect.top,
      px: event.clientX, py: event.clientY, x: 0, y: 0, vx: 0, tilt: 0, lift: 1,
      active: false, returning: false, slotY: 0, target: displayIndex, overSlit: false, canShred: false, last: 0, raf: 0,
    }
    const l = listeners.current!
    window.addEventListener('pointermove', l.move)
    window.addEventListener('pointerup', l.up)
    window.addEventListener('pointercancel', l.cancel)
  }, [])

  /** 拖动期间各行的位移：被拖行留空位，起止之间的行向空位方向让一格。 */
  const rowShift = useCallback((displayIndex: number): number => {
    if (!drag || displayIndex === drag.from) return 0
    const { from, target } = drag
    if (from < target && displayIndex > from && displayIndex <= target) return -rowHeight
    if (target < from && displayIndex >= target && displayIndex < from) return rowHeight
    return 0
  }, [drag, rowHeight])

  const ghost = <div ref={ghostRef} className={styles.dragGhost} aria-hidden="true" />
  const strips = shreds.map((shred) => (
    <ShredStrips key={shred.id} shred={shred} onDone={() => setShreds((list) => list.filter((s) => s.id !== shred.id))} />
  ))

  return { drag, onRowPointerDown, rowShift, ghost, strips }
}

/** 碎纸：被移除的行从右侧竖缝穿出，横切成条，依次错开向右飘落并淡出。 */
function ShredStrips({ shred, onDone }: { shred: Shred; onDone(): void }) {
  const controlMotion = useMotion('dragMotion')
  const mounted = useRef(0)
  return (
    <div className={styles.shred} style={{ left: shred.left, top: shred.top, width: shred.width, height: shred.height }} aria-hidden="true">
      {Array.from({ length: STRIPS }, (_, k) => {
        const from = (k / STRIPS) * 100
        const to = 100 - ((k + 1) / STRIPS) * 100
        const spread = (k - (STRIPS - 1) / 2) * 3
        return (
          <motion.div
            key={k}
            className={styles.shredStrip}
            style={{ clipPath: `inset(${from}% 0 ${to}% 0)` }}
            initial={{ y: 0, x: 0, rotate: 0, opacity: 1 }}
            animate={{ x: shred.width * 0.45 + (k % 3) * 14, y: spread + 18, rotate: ((k * 37) % 11) - 5, opacity: 0 }}
            transition={controlMotion ? { duration: queueShredStrip.duration, ease: queueShredStrip.ease, delay: k * queueShredStrip.stagger } : { duration: 0 }}
            onAnimationComplete={() => { if (++mounted.current === STRIPS) onDone() }}
            ref={(el) => { if (el && !el.firstChild) el.appendChild(shred.node.cloneNode(true)) }}
          />
        )
      })}
    </div>
  )
}
