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
  const [progress, setProgress] = useState(0)
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    return observeHorizontalCardRail(viewport, (next) => {
      setEdges((current) => current.previous === next.previous && current.next === next.next ? current : next)
      const maximum = viewport.scrollWidth - viewport.clientWidth
      setProgress(maximum > 0 ? viewport.scrollLeft / maximum * 100 : 0)
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
          if (!event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey
            && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) event.stopPropagation()
        }}
        role="group"
        aria-label={label}
      >
        {children}
      </div>
      {(edges.previous || edges.next) && <input
        type="range"
        className={`${styles.dragHandle} no-drag`}
        min={0}
        max={100}
        step={0.1}
        value={progress}
        aria-label={`${label}，拖动位置`}
        aria-valuetext={`已滚动 ${Math.round(progress)}%`}
        onInput={event => {
          const viewport = viewportRef.current
          if (viewport) viewport.scrollLeft = Number(event.currentTarget.value) / 100 * (viewport.scrollWidth - viewport.clientWidth)
        }}
      />}
    </div>
  )
}
