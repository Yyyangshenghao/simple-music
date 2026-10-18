import { useEffect, useRef, useState, type ReactNode } from 'react'
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
  viewport.addEventListener('scroll', update)
  const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(update)
  observer?.observe(viewport)
  // 图片加载或卡片自身布局变化也会改变 scrollWidth。
  for (const child of viewport.children) observer?.observe(child)
  update()
  return () => {
    viewport.removeEventListener('scroll', update)
    observer?.disconnect()
  }
}

interface HorizontalCardRailProps {
  children: ReactNode
  label: string
  className?: string
}

export function HorizontalCardRail({ children, label, className }: HorizontalCardRailProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState<RailEdges>({ previous: false, next: false })
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    return observeHorizontalCardRail(viewport, (next) => {
      setEdges((current) => current.previous === next.previous && current.next === next.next ? current : next)
    })
  }, [children])

  return (
    <div className={styles.rail}>
      <div
        ref={viewportRef}
        className={[styles.viewport, edges.previous && styles.fadeLeft, edges.next && styles.fadeRight, className].filter(Boolean).join(' ')}
        tabIndex={0}
        data-arrow-navigation
        onKeyDown={event => {
          if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
          if (event.target === event.currentTarget && (event.key === 'Home' || event.key === 'End')) {
            event.preventDefault()
            event.stopPropagation()
            event.currentTarget.scrollLeft = event.key === 'Home' ? 0 : event.currentTarget.scrollWidth - event.currentTarget.clientWidth
          }
          if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) event.stopPropagation()
        }}
        role="group"
        aria-label={label}
      >
        {children}
      </div>
    </div>
  )
}
