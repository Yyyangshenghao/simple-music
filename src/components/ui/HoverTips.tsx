import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, animate, motion, useMotionValue, useTransform, type AnimationPlaybackControls, type Variants } from 'motion/react'
import { hoverTipPosition, hoverTipText } from './hover-tip'
import { useSystemReducedMotion } from '../../hooks/useSystemReducedMotion'
import { useMotion } from '../../hooks/useMotion'
import { tooltipGlide, tooltipPop, tooltipSwap } from '../../lib/motion-presets'
import styles from './HoverTips.module.css'

/** 首次悬停多久后出现；提示刚消失不久再移到相邻按钮则立即出现。 */
const SHOW_DELAY = 350
const WARM_WINDOW = 600
/** 离开按钮后稍等再收起，扫过按钮间缝隙时不闪。 */
const GRACE = 80
const EDGE_GAP = 8
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
  bottom: number
  /** cold：首次弹出；warm：刚收起又出现，直接显示；move：从上一个按钮滑过来。 */
  mode: 'cold' | 'warm' | 'move'
  dir: number
}

const LAYER: Variants = {
  enter: (dir: number) => ({ opacity: 0, x: SWAP_SHIFT * dir, filter: dir === 0 ? 'blur(0px)' : 'blur(3px)' }),
  show: { opacity: 1, x: 0, filter: 'blur(0px)' },
  exit: (dir: number) => ({ opacity: 0, x: -SWAP_SHIFT * dir, filter: 'blur(3px)' }),
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/**
 * 给父容器内的图标按钮统一显示悬停文字提示：读取 data-tip、title 或 aria-label。
 * 整组共用一个气泡：首次悬停稍候弹出，之后在相邻按钮间滑动并换字；渲染到 body，不受面板裁切。
 * 放在父容器内即可；match 限定哪些按钮提示，exclude 内的按钮不提示，容器内有面板展开时也不提示。
 */
export function HoverTips({ exclude, match = 'button' }: { exclude?: string; match?: string }) {
  const iconMotion = useMotion('iconMotion')
  const systemReduced = useSystemReducedMotion()
  const reducedMotion = !iconMotion || systemReduced
  const tooltipId = useId()
  const [below, setBelow] = useState(false)
  const anchorRef = useRef<HTMLSpanElement>(null)
  const textRef = useRef<HTMLSpanElement | null>(null)
  const [tip, setTip] = useState<Tip | null>(null)
  const reducedRef = useRef(reducedMotion)
  reducedRef.current = reducedMotion

  const ax = useMotionValue(0)
  const width = useMotionValue(0)
  const height = useMotionValue(HEIGHT)
  const presence = useMotionValue(0)
  const left = useMotionValue(0)
  const top = useMotionValue(0)
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
    let shown: { cx: number; text: string } | null = null
    let nextId = 0
    let observer: MutationObserver | null = null
    const textFor = (button: HTMLElement) => hoverTipText({ disabled: (button as HTMLButtonElement).disabled, tip: button.dataset.tip, title: button.getAttribute('title'), label: button.getAttribute('aria-label') })
    const restore = (button: HTMLElement) => {
      const ids = button.getAttribute('aria-describedby')?.split(/\s+/).filter(id => id !== tooltipId).join(' ')
      if (ids) button.setAttribute('aria-describedby', ids)
      else button.removeAttribute('aria-describedby')
    }

    const close = (instant: boolean) => {
      clearTimeout(showTimer)
      clearTimeout(graceTimer)
      if (current || shown) warmUntil = Date.now() + WARM_WINDOW
      if (current) restore(current)
      current = null
      observer?.disconnect()
      closing.current?.stop()
      closing.current = null
      if (!shown) return
      const finish = () => { shown = null; closing.current = null; setTip(null) }
      if (instant || reducedRef.current) { presence.jump(0); finish(); return }
      graceTimer = setTimeout(() => {
        const animation = animate(presence, 0, { duration: tooltipPop.duration * 0.8, ease: tooltipPop.ease })
        closing.current = animation
        void animation.finished.then(() => { if (closing.current === animation) finish() })
      }, GRACE)
    }
    const show = (button: HTMLElement) => {
      const text = textFor(button)
      if (!text || !button.isConnected) { close(true); return }
      clearTimeout(graceTimer)
      closing.current?.stop()
      closing.current = null
      const rect = button.getBoundingClientRect()
      const cx = rect.left + rect.width / 2
      const mode: Tip['mode'] = shown ? 'move' : Date.now() < warmUntil ? 'warm' : 'cold'
      const dir = shown ? Math.sign(cx - shown.cx) : 0
      shown = { cx, text }
      const ids = new Set(button.getAttribute('aria-describedby')?.split(/\s+/).filter(Boolean))
      ids.add(tooltipId)
      button.setAttribute('aria-describedby', [...ids].join(' '))
      setTip({ id: ++nextId, text, cx, top: rect.top, bottom: rect.bottom, mode, dir })
    }
    observer = typeof MutationObserver === 'undefined' ? null : new MutationObserver(() => {
      if (!current) return
      if (!current.isConnected || !host.contains(current) || host.querySelector('[aria-expanded="true"]')) { close(true); return }
      // 暂停/继续、任务完成或禁用原因变化时，不要求用户再移动一次鼠标。
      if (shown && textFor(current) !== shown.text) show(current)
    })
    const handleOver = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' || event.buttons !== 0) return
      const button = (event.target as Element).closest?.(match) as HTMLButtonElement | null
      // 有面板展开时（队列、更多菜单等）整组不提示，也避免给面板内部的按钮加提示。
      const valid = button && host.contains(button) && !(exclude && button.closest(exclude))
        && (!button.disabled || !!button.dataset.tip) && !host.querySelector('[aria-expanded="true"]')
      if (!valid) {
        if (current) close(false)
        return
      }
      if (button === current) return
      clearTimeout(showTimer)
      if (current) restore(current)
      current = button
      observer?.observe(host, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-tip', 'title', 'aria-label', 'disabled', 'aria-expanded'] })
      if (Date.now() < warmUntil || shown) show(button)
      else showTimer = setTimeout(() => current === button && show(button), SHOW_DELAY)
    }
    const handleLeave = () => close(false)
    const handleDown = () => close(true)
    const handleScroll = () => close(true)
    const handleKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close(true) }

    host.addEventListener('pointerover', handleOver)
    host.addEventListener('pointerleave', handleLeave)
    host.addEventListener('pointerdown', handleDown)
    window.addEventListener('scroll', handleScroll, { capture: true, passive: true })
    window.addEventListener('resize', handleScroll)
    window.addEventListener('blur', handleScroll)
    window.addEventListener('keydown', handleKey, true)
    return () => {
      clearTimeout(showTimer)
      clearTimeout(graceTimer)
      host.removeEventListener('pointerover', handleOver)
      host.removeEventListener('pointerleave', handleLeave)
      host.removeEventListener('pointerdown', handleDown)
      window.removeEventListener('scroll', handleScroll, { capture: true })
      window.removeEventListener('resize', handleScroll)
      window.removeEventListener('blur', handleScroll)
      window.removeEventListener('keydown', handleKey, true)
      if (current) restore(current)
      observer?.disconnect()
      closing.current?.stop()
    }
  }, [exclude, match, presence, tooltipId])

  // 量出新文字宽度后再定位：滑动时气泡同步伸缩，首次出现时直接落位再弹出。
  useLayoutEffect(() => {
    const text = textRef.current
    if (!tip || !text) return
    const nextWidth = Math.min(window.innerWidth - EDGE_GAP * 2, text.offsetWidth + PAD_X * 2)
    const nextHeight = Math.max(HEIGHT, text.offsetHeight + 8)
    const placement = hoverTipPosition(tip, { width: nextWidth, height: nextHeight }, { width: window.innerWidth, height: window.innerHeight })
    setBelow(placement.below)
    height.jump(nextHeight)
    if (tip.mode === 'move' && !reducedMotion) {
      animate(ax, tip.cx, tooltipGlide)
      animate(left, placement.left, tooltipGlide)
      animate(top, placement.top, tooltipGlide)
      animate(width, nextWidth, tooltipGlide)
      animate(presence, 1, { duration: 0.12, ease: tooltipPop.ease })
      return
    }
    ax.jump(tip.cx)
    left.jump(placement.left)
    top.jump(placement.top)
    width.jump(nextWidth)
    if (tip.mode === 'cold' && !reducedMotion) {
      presence.jump(0)
      animate(presence, 1, { duration: tooltipPop.duration, ease: tooltipPop.ease })
    } else {
      presence.jump(1)
    }
  }, [tip, reducedMotion, ax, left, top, width, height, presence])

  return (
    <>
      <span ref={anchorRef} hidden />
      {tip && createPortal(
        <motion.div id={tooltipId} className={styles.tip} data-below={below} role="tooltip" style={{ left, top, width, height }}>
          <motion.div className={styles.box} style={{ scale, y: rise, opacity: presence, filter: blur }}>
            <AnimatePresence initial={false} custom={tip.dir}>
              <motion.span
                key={tip.id}
                className={styles.layer}
                custom={tip.dir}
                variants={LAYER}
                initial={reducedMotion ? false : 'enter'}
                animate="show"
                exit={reducedMotion ? { opacity: 0 } : 'exit'}
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
