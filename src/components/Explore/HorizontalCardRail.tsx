import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
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
  const [visibleRatio, setVisibleRatio] = useState(1)
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    return observeHorizontalCardRail(viewport, (next) => {
      setEdges((current) => current.previous === next.previous && current.next === next.next ? current : next)
      const maximum = viewport.scrollWidth - viewport.clientWidth
      setProgress(maximum > 0 ? viewport.scrollLeft / maximum * 100 : 0)
      setVisibleRatio(viewport.scrollWidth > 0 ? viewport.clientWidth / viewport.scrollWidth : 1)
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
      {(edges.previous || edges.next) && <span className={styles.scrollControl} style={{ '--rail-visible-ratio': visibleRatio, '--rail-progress': progress / 100 } as CSSProperties}>
        <input
          type="range"
          className={`${styles.dragHandle} no-drag`}
          min={0}
          max={100}
          step={0.1}
          value={progress}
          aria-label={`${label}，拖动位置`}
          aria-valuetext={`已滚动 ${Math.round(progress)}%`}
          title="拖动浏览，或使用左右方向键"
          onInput={event => {
            const viewport = viewportRef.current
            if (!viewport) return
            const maximum = viewport.scrollWidth - viewport.clientWidth
            viewport.scrollLeft = Number(event.currentTarget.value) / 100 * maximum
            setProgress(maximum > 0 ? viewport.scrollLeft / maximum * 100 : 0)
          }}
        />
        <svg className={styles.grip} width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2 3v6M6 3v6M10 3v6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>
      </span>}
    </div>
  )
}
