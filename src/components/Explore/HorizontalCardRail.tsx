import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import styles from './HorizontalCardRail.module.css'

interface RailEdges {
  previous: boolean
  next: boolean
}

export function observeHorizontalCardRail(viewport: HTMLElement, onChange: (edges: RailEdges) => void): () => void {
  const update = () => {
    const maximum = Math.max(0, viewport.scrollWidth - viewport.clientWidth)
    onChange({ previous: maximum > 1 && viewport.scrollLeft > 1, next: maximum > 1 && viewport.scrollLeft < maximum - 1 })
  }
  const onWheel = (event: WheelEvent) => {
    // 触控板横向手势、Shift 横滚和缩放保持浏览器的原生处理。
    if (event.ctrlKey || event.shiftKey || event.deltaX !== 0 || event.deltaY === 0) return
    const maximum = Math.max(0, viewport.scrollWidth - viewport.clientWidth)
    if (maximum <= 1 || (event.deltaY < 0 && viewport.scrollLeft <= 0) || (event.deltaY > 0 && viewport.scrollLeft >= maximum - 1)) return
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientWidth : 1
    event.preventDefault()
    viewport.scrollLeft = Math.max(0, Math.min(maximum, viewport.scrollLeft + event.deltaY * unit))
    update()
  }
  viewport.addEventListener('scroll', update)
  viewport.addEventListener('wheel', onWheel, { passive: false })
  const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(update)
  observer?.observe(viewport)
  // 图片加载或卡片自身布局变化也会改变 scrollWidth。
  for (const child of viewport.children) observer?.observe(child)
  update()
  return () => {
    viewport.removeEventListener('scroll', update)
    viewport.removeEventListener('wheel', onWheel)
    observer?.disconnect()
  }
}

export function scrollHorizontalCardRailPage(viewport: HTMLElement, direction: -1 | 1, reducedMotion: boolean): void {
  viewport.scrollBy({ left: direction * viewport.clientWidth * 0.85, behavior: reducedMotion ? 'auto' : 'smooth' })
}

interface HorizontalCardRailProps {
  children: ReactNode
  label: string
  className?: string
}

export function HorizontalCardRail({ children, label, className }: HorizontalCardRailProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState<RailEdges>({ previous: false, next: false })
  const reducedMotion = useReducedMotion()
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    return observeHorizontalCardRail(viewport, (next) => {
      setEdges((current) => current.previous === next.previous && current.next === next.next ? current : next)
    })
  }, [children])

  const page = (direction: -1 | 1) => {
    if (viewportRef.current) scrollHorizontalCardRailPage(viewportRef.current, direction, reducedMotion)
  }
  return (
    <div className={styles.rail}>
      <div
        ref={viewportRef}
        className={[styles.viewport, edges.previous && styles.fadeLeft, edges.next && styles.fadeRight, className].filter(Boolean).join(' ')}
        role="group"
        aria-label={label}
      >
        {children}
      </div>
      {(edges.previous || edges.next) && <>
        <button type="button" className={`${styles.arrow} ${styles.previous} no-drag`} aria-label={`${label}，上一页`} disabled={!edges.previous} onClick={() => page(-1)}>
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="m15.5 5-7 7 7 7" /></svg>
        </button>
        <button type="button" className={`${styles.arrow} ${styles.next} no-drag`} aria-label={`${label}，下一页`} disabled={!edges.next} onClick={() => page(1)}>
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="m8.5 5 7 7-7 7" /></svg>
        </button>
      </>}
    </div>
  )
}
