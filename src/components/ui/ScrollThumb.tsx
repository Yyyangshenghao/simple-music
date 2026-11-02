import { useEffect, useRef, useState, type RefObject } from 'react'
import styles from './ScrollThumb.module.css'

/** 滚动停下后多久淡出。 */
const IDLE_MS = 900
const MIN_THUMB = 28

interface ScrollThumbProps {
  /** 要接管的滚动容器；它自己的原生滚动条需隐藏（加 data-scroll-thumb-host 或自行 scrollbar-width: none）。 */
  target: RefObject<HTMLElement>
  className?: string
}

/**
 * 自绘竖向滚动条：叠在容器右缘，不占内容宽度。滚动或悬停时浮现，停下后淡出；
 * 悬停变粗，可拖动滑块，点轨道按页翻。颜色取 currentColor，跟随所在面板的文字色。
 */
export function ScrollThumb({ target, className }: ScrollThumbProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const thumbRef = useRef<HTMLDivElement>(null)
  const [overflowing, setOverflowing] = useState(false)
  const [active, setActive] = useState(false)
  const [dragging, setDragging] = useState(false)
  const idleTimer = useRef<number | undefined>(undefined)
  const drag = useRef<{ y: number; top: number; ratio: number } | null>(null)

  useEffect(() => {
    const host = target.current
    const track = trackRef.current
    const thumb = thumbRef.current
    if (!host || !track || !thumb) return
    host.setAttribute('data-scroll-thumb-host', '')

    // 直接写样式，不随滚动重渲染。
    const layout = () => {
      const { scrollHeight, clientHeight, scrollTop } = host
      const max = scrollHeight - clientHeight
      setOverflowing(max > 1)
      if (max <= 1) return
      const trackLength = track.clientHeight
      const length = Math.max(MIN_THUMB, trackLength * clientHeight / scrollHeight)
      thumb.style.height = `${length}px`
      thumb.style.transform = `translateY(${(trackLength - length) * (scrollTop / max)}px)`
    }

    const onScroll = () => {
      layout()
      setActive(true)
      window.clearTimeout(idleTimer.current)
      idleTimer.current = window.setTimeout(() => setActive(false), IDLE_MS)
    }

    layout()
    host.addEventListener('scroll', onScroll, { passive: true })
    // 内容高度变化（展开、切换视图）要重新量：观察容器和它的子节点。
    const observer = new ResizeObserver(layout)
    observer.observe(host)
    for (const child of Array.from(host.children)) observer.observe(child)
    const mutations = new MutationObserver(() => {
      for (const child of Array.from(host.children)) observer.observe(child)
      layout()
    })
    mutations.observe(host, { childList: true })
    return () => {
      host.removeEventListener('scroll', onScroll)
      host.removeAttribute('data-scroll-thumb-host')
      observer.disconnect()
      mutations.disconnect()
      window.clearTimeout(idleTimer.current)
    }
  }, [target])

  const onThumbDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const host = target.current
    const track = trackRef.current
    const thumb = thumbRef.current
    if (!host || !track || !thumb || event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const room = track.clientHeight - thumb.offsetHeight
    drag.current = { y: event.clientY, top: host.scrollTop, ratio: room > 0 ? (host.scrollHeight - host.clientHeight) / room : 0 }
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragging(true)
  }

  const onThumbMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = drag.current
    const host = target.current
    if (!state || !host) return
    // 在窗口外松开时可能收不到 pointerup：键已抬起就结束拖动。
    if ((event.buttons & 1) === 0) { endDrag(); return }
    host.scrollTop = state.top + (event.clientY - state.y) * state.ratio
  }

  const endDrag = () => {
    drag.current = null
    setDragging(false)
  }

  // 点轨道空白处：朝点击方向翻一页。
  const onTrackDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const host = target.current
    const thumb = thumbRef.current
    if (!host || !thumb || event.button !== 0 || event.target !== event.currentTarget) return
    const below = event.clientY > thumb.getBoundingClientRect().bottom
    host.scrollBy({ top: (below ? 1 : -1) * host.clientHeight * 0.85, behavior: 'smooth' })
  }

  return (
    <div ref={trackRef} className={`${styles.track}${className ? ` ${className}` : ''}`} aria-hidden="true"
      data-overflowing={overflowing} data-active={active || dragging} data-dragging={dragging}
      onPointerDown={onTrackDown}>
      <div ref={thumbRef} className={styles.thumb}
        onPointerDown={onThumbDown} onPointerMove={onThumbMove} onPointerUp={endDrag} onPointerCancel={endDrag}
        onLostPointerCapture={endDrag} />
    </div>
  )
}
