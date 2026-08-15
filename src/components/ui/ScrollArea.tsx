import { useEffect, useRef, useState, type ReactNode } from 'react'
import styles from './ScrollArea.module.css'

interface ScrollAreaProps {
  children: ReactNode
  /** 应用到滚动容器本身的类名（内边距、定位等） */
  className?: string
  /** 滚动距离超过阈值（8px）时触发，用于让吸顶元素在滚动后才显示背景 */
  onScrolledChange?: (scrolled: boolean) => void
}

const HIDE_DELAY = 800
const MIN_THUMB_HEIGHT = 32
const SCROLLED_THRESHOLD = 8

/** 隐藏原生滚动条的滚动容器，滚动时淡入一条自绘细滚动条，停止滚动后自动淡出。 */
export function ScrollArea({ children, className, onScrolledChange }: ScrollAreaProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const thumbRef = useRef<HTMLDivElement>(null)
  const [thumb, setThumb] = useState({ top: 0, height: 0 })
  const [visible, setVisible] = useState(false)
  const [dragging, setDragging] = useState(false)
  const onScrolledChangeRef = useRef(onScrolledChange)
  onScrolledChangeRef.current = onScrolledChange

  useEffect(() => {
    const el = viewportRef.current
    const thumbEl = thumbRef.current
    if (!el || !thumbEl) return
    let hideTimer: ReturnType<typeof setTimeout> | null = null
    let raf: number | null = null
    let wasScrolled = false

    function measure() {
      const node = el!
      const { scrollTop, scrollHeight, clientHeight } = node
      if (scrollHeight <= clientHeight) {
        setThumb({ top: 0, height: 0 })
        return
      }
      const height = Math.max((clientHeight / scrollHeight) * clientHeight, MIN_THUMB_HEIGHT)
      const top = (scrollTop / (scrollHeight - clientHeight)) * (clientHeight - height)
      setThumb({ top, height })
    }

    function show() {
      setVisible(true)
      if (hideTimer) clearTimeout(hideTimer)
      hideTimer = setTimeout(() => setVisible(false), HIDE_DELAY)
    }

    function onScroll() {
      if (raf === null) {
        raf = requestAnimationFrame(() => {
          raf = null
          measure()
        })
      }
      show()

      const scrolled = el!.scrollTop > SCROLLED_THRESHOLD
      if (scrolled !== wasScrolled) {
        wasScrolled = scrolled
        onScrolledChangeRef.current?.(scrolled)
      }
    }

    // 拖拽自绘滚动条:把指针在轨道上的位移按比例映射成 viewport.scrollTop,
    // 让用户能像拖原生滚动条一样快速跳到列表任意位置(原生滚动条已被隐藏)。
    let dragging = false
    let startClientY = 0
    let startScrollTop = 0
    let trackRange = 0
    let scrollRange = 0

    function onPointerDown(e: PointerEvent) {
      if (e.button !== 0) return
      const node = el!
      const { scrollTop, scrollHeight, clientHeight } = node
      if (scrollHeight <= clientHeight) return
      const height = Math.max((clientHeight / scrollHeight) * clientHeight, MIN_THUMB_HEIGHT)
      dragging = true
      setDragging(true)
      startClientY = e.clientY
      startScrollTop = scrollTop
      trackRange = clientHeight - height
      scrollRange = scrollHeight - clientHeight
      // 拖拽期间保持可见、不淡出
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null }
      setVisible(true)
      ;(e.target as Element).setPointerCapture?.(e.pointerId)
      e.preventDefault()
    }

    function onPointerMove(e: PointerEvent) {
      if (!dragging) return
      const delta = e.clientY - startClientY
      const ratio = trackRange > 0 ? delta / trackRange : 0
      const next = Math.max(0, Math.min(scrollRange, startScrollTop + ratio * scrollRange))
      el!.scrollTop = next // 直接设 scrollTop,会触发 onScroll → measure 更新 thumb 位置
    }

    function endDrag(e: PointerEvent) {
      if (!dragging) return
      dragging = false
      setDragging(false)
      ;(e.target as Element).releasePointerCapture?.(e.pointerId)
      show() // 恢复淡出计时
    }

    measure()
    onScrolledChangeRef.current?.(el.scrollTop > SCROLLED_THRESHOLD)
    el.addEventListener('scroll', onScroll, { passive: true })
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    thumbEl.addEventListener('pointerdown', onPointerDown)
    thumbEl.addEventListener('pointermove', onPointerMove)
    thumbEl.addEventListener('pointerup', endDrag)
    thumbEl.addEventListener('pointercancel', endDrag)

    return () => {
      el.removeEventListener('scroll', onScroll)
      ro.disconnect()
      thumbEl.removeEventListener('pointerdown', onPointerDown)
      thumbEl.removeEventListener('pointermove', onPointerMove)
      thumbEl.removeEventListener('pointerup', endDrag)
      thumbEl.removeEventListener('pointercancel', endDrag)
      if (hideTimer) clearTimeout(hideTimer)
      if (raf !== null) cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <div className={styles.root}>
      <div ref={viewportRef} className={`${styles.viewport} ${className ?? ''}`}>
        {children}
      </div>
      <div className={`${styles.track} ${visible || dragging ? styles.visible : ''} ${thumb.height > 0 ? '' : styles.hidden}`} aria-hidden="true">
        <div
          ref={thumbRef}
          className={styles.thumb}
          data-dragging={dragging ? 'true' : 'false'}
          style={{ transform: `translateY(${thumb.top}px)`, height: `${thumb.height}px` }}
        />
      </div>
    </div>
  )
}
