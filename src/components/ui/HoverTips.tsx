import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, animate, motion, useMotionValue, useTransform, type AnimationPlaybackControls, type Variants } from 'motion/react'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import { tooltipGlide, tooltipPop, tooltipSwap } from '../../lib/motion-presets'
import styles from './HoverTips.module.css'

/** 首次悬停多久后出现；提示刚消失不久再移到相邻按钮则立即出现。 */
const SHOW_DELAY = 350
const WARM_WINDOW = 600
/** 离开按钮后稍等再收起，扫过按钮间缝隙时不闪。 */
const GRACE = 80
const EDGE_GAP = 8
const GAP = 8
const HEIGHT = 24
const PAD_X = 9
/** 文字换入换出时的错位距离。 */
const SWAP_SHIFT = 10

interface Tip {
  id: number
  text: string
  /** 按钮水平中心与顶部（视口坐标）。 */
  cx: number
  top: number
  /** cold：首次弹出；warm：刚收起又出现，直接显示；move：从上一个按钮滑过来。 */
  mode: 'cold' | 'warm' | 'move'
  dir: number
}

const LAYER: Variants = {
  enter: (dir: number) => ({ opacity: dir === 0 ? 1 : 0, x: SWAP_SHIFT * dir, filter: dir === 0 ? 'blur(0px)' : 'blur(3px)' }),
  show: { opacity: 1, x: 0, filter: 'blur(0px)' },
  exit: (dir: number) => ({ opacity: 0, x: -SWAP_SHIFT * dir, filter: 'blur(3px)' }),
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/**
 * 给父容器内的图标按钮统一显示悬停文字提示（参考 React Bits WarmTooltip）：读取 data-tip，没有时用 aria-label。
 * 整组共用一个气泡：首次悬停稍候弹出，之后在相邻按钮间滑动并换字；渲染到 body，不受面板裁切。
 * 放在父容器内即可；match 限定哪些按钮提示，exclude 内的按钮不提示，容器内有面板展开时也不提示。
 */
export function HoverTips({ exclude, match = 'button' }: { exclude?: string; match?: string }) {
  const reducedMotion = useReducedMotion()
  const anchorRef = useRef<HTMLSpanElement>(null)
  const textRef = useRef<HTMLSpanElement | null>(null)
  const [tip, setTip] = useState<Tip | null>(null)
  const reducedRef = useRef(reducedMotion)
  reducedRef.current = reducedMotion

  const ax = useMotionValue(0)
  const ay = useMotionValue(0)
  const width = useMotionValue(0)
  const presence = useMotionValue(0)
  const left = useTransform(() => clamp(ax.get() - width.get() / 2, EDGE_GAP, Math.max(EDGE_GAP, (typeof window === 'undefined' ? Infinity : window.innerWidth) - EDGE_GAP - width.get())))
  const top = useTransform(() => ay.get() - GAP - HEIGHT)
  const arrowLeft = useTransform(() => clamp(ax.get() - left.get(), 10, Math.max(10, width.get() - 10)))
  const scale = useTransform(presence, (p) => (reducedMotion ? 1 : tooltipPop.scale + (1 - tooltipPop.scale) * p))
  const rise = useTransform(presence, (p) => (reducedMotion ? 0 : (1 - p) * tooltipPop.rise))
  const blur = useTransform(presence, (p) => (reducedMotion ? 'none' : `blur(${tooltipPop.blur * (1 - p)}px)`))
  const closing = useRef<AnimationPlaybackControls | null>(null)

  useEffect(() => {
    const host = anchorRef.current?.parentElement
    if (!host) return
    let showTimer: ReturnType<typeof setTimeout> | undefined
    let graceTimer: ReturnType<typeof setTimeout> | undefined
    let warmUntil = 0
    let current: HTMLElement | null = null
    let shown: { cx: number } | null = null
    let nextId = 0

    const close = (instant: boolean) => {
      clearTimeout(showTimer)
      clearTimeout(graceTimer)
      if (current || shown) warmUntil = Date.now() + WARM_WINDOW
      current = null
      if (!shown) return
      const finish = () => { shown = null; closing.current = null; setTip(null) }
      if (instant || reducedRef.current) { presence.jump(0); finish(); return }
      graceTimer = setTimeout(() => {
        closing.current = animate(presence, 0, { duration: tooltipPop.duration * 0.8, ease: tooltipPop.ease })
        void closing.current.finished.then(finish)
      }, GRACE)
    }
    const show = (button: HTMLElement) => {
      const text = button.dataset.tip || button.getAttribute('aria-label')
      if (!text) return
      clearTimeout(graceTimer)
      closing.current?.stop()
      closing.current = null
      const rect = button.getBoundingClientRect()
      const cx = rect.left + rect.width / 2
      const mode: Tip['mode'] = shown ? 'move' : Date.now() < warmUntil ? 'warm' : 'cold'
      const dir = shown ? Math.sign(cx - shown.cx) || 1 : 0
      shown = { cx }
      setTip({ id: ++nextId, text, cx, top: rect.top, mode, dir })
    }
    const handleOver = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' || event.buttons !== 0) return
      const button = (event.target as Element).closest?.(match) as HTMLButtonElement | null
      // 有面板展开时（队列、更多菜单等）整组不提示，也避免给面板内部的按钮加提示。
      const valid = button && host.contains(button) && !(exclude && button.closest(exclude))
        && !button.disabled && !host.querySelector('[aria-expanded="true"]')
      if (!valid) {
        if (current) close(false)
        return
      }
      if (button === current) return
      clearTimeout(showTimer)
      current = button
      if (Date.now() < warmUntil || shown) show(button)
      else showTimer = setTimeout(() => current === button && show(button), SHOW_DELAY)
    }
    const handleLeave = () => close(false)
    const handleDown = () => close(true)
    const handleScroll = () => close(true)

    host.addEventListener('pointerover', handleOver)
    host.addEventListener('pointerleave', handleLeave)
    host.addEventListener('pointerdown', handleDown)
    host.addEventListener('scroll', handleScroll, { capture: true, passive: true })
    return () => {
      clearTimeout(showTimer)
      clearTimeout(graceTimer)
      host.removeEventListener('pointerover', handleOver)
      host.removeEventListener('pointerleave', handleLeave)
      host.removeEventListener('pointerdown', handleDown)
      host.removeEventListener('scroll', handleScroll, { capture: true })
    }
  }, [exclude, match, presence])

  // 量出新文字宽度后再定位：滑动时气泡同步伸缩，首次出现时直接落位再弹出。
  useLayoutEffect(() => {
    const text = textRef.current
    if (!tip || !text) return
    const nextWidth = text.offsetWidth + PAD_X * 2
    if (tip.mode === 'move' && !reducedMotion) {
      animate(ax, tip.cx, tooltipGlide)
      animate(ay, tip.top, tooltipGlide)
      animate(width, nextWidth, tooltipGlide)
      animate(presence, 1, { duration: 0.12, ease: tooltipPop.ease })
      return
    }
    ax.jump(tip.cx)
    ay.jump(tip.top)
    width.jump(nextWidth)
    if (tip.mode === 'cold' && !reducedMotion) {
      presence.jump(0)
      animate(presence, 1, { duration: tooltipPop.duration, ease: tooltipPop.ease })
    } else {
      presence.jump(1)
    }
  }, [tip, reducedMotion, ax, ay, width, presence])

  return (
    <>
      <span ref={anchorRef} hidden />
      {tip && createPortal(
        <motion.div className={styles.tip} role="tooltip" style={{ left, top, width, height: HEIGHT }}>
          <motion.div className={styles.box} style={{ scale, y: rise, opacity: presence, filter: blur }}>
            <AnimatePresence initial={false} custom={tip.dir}>
              <motion.span
                key={tip.id}
                className={styles.layer}
                custom={tip.dir}
                variants={LAYER}
                initial="enter"
                animate="show"
                exit="exit"
                transition={reducedMotion ? { duration: 0 } : tooltipSwap}
              >
                <span ref={(el) => { if (el) textRef.current = el }} className={styles.text}>{tip.text}</span>
              </motion.span>
            </AnimatePresence>
            <motion.span className={styles.arrow} style={{ left: arrowLeft }} aria-hidden="true" />
          </motion.div>
        </motion.div>,
        document.body
      )}
    </>
  )
}
