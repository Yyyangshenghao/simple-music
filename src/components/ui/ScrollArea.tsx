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
  const [thumb, setThumb] = useState({ top: 0, height: 0 })
  const [visible, setVisible] = useState(false)
  const onScrolledChangeRef = useRef(onScrolledChange)
  onScrolledChangeRef.current = onScrolledChange

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
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

    function onScroll() {
      if (raf === null) {
        raf = requestAnimationFrame(() => {
          raf = null
          measure()
        })
      }
      setVisible(true)
      if (hideTimer) clearTimeout(hideTimer)
      hideTimer = setTimeout(() => setVisible(false), HIDE_DELAY)

      const scrolled = el!.scrollTop > SCROLLED_THRESHOLD
      if (scrolled !== wasScrolled) {
        wasScrolled = scrolled
        onScrolledChangeRef.current?.(scrolled)
      }
    }

    measure()
    onScrolledChangeRef.current?.(el.scrollTop > SCROLLED_THRESHOLD)
    el.addEventListener('scroll', onScroll, { passive: true })
    const ro = new ResizeObserver(measure)
    ro.observe(el)

    return () => {
      el.removeEventListener('scroll', onScroll)
      ro.disconnect()
      if (hideTimer) clearTimeout(hideTimer)
      if (raf !== null) cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <div className={styles.root}>
      <div ref={viewportRef} className={`${styles.viewport} ${className ?? ''}`}>
        {children}
      </div>
      <div className={`${styles.track} ${visible && thumb.height > 0 ? styles.visible : ''}`} aria-hidden="true">
        <div className={styles.thumb} style={{ transform: `translateY(${thumb.top}px)`, height: `${thumb.height}px` }} />
      </div>
    </div>
  )
}
