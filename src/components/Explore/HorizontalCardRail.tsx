import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import { bindRailDrag, measureRail, nearestRailPosition, railProgress } from './rail-navigation'
import styles from './HorizontalCardRail.module.css'

interface RailEdges {
  previous: boolean
  next: boolean
}

export function observeHorizontalCardRail(viewport: HTMLElement, onChange: (edges: RailEdges) => void, onResize?: () => void): () => void {
  const update = () => {
    const maximum = Math.max(0, viewport.scrollWidth - viewport.clientWidth)
    onChange({ previous: maximum > 1 && viewport.scrollLeft > 1, next: maximum > 1 && viewport.scrollLeft < maximum - 1 })
  }
  viewport.addEventListener('scroll', update)
  const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => { onResize?.(); update() })
  observer?.observe(viewport)
  // 图片加载或卡片自身布局变化也会改变 scrollWidth。
  for (const child of viewport.children) observer?.observe(child)
  onResize?.()
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
  const navigationRef = useRef<HTMLDivElement>(null)
  const scrubGestureRef = useRef<{ start: number; moved: boolean } | null>(null)
  const reducedMotion = useReducedMotion()
  const reducedMotionRef = useRef(reducedMotion)
  reducedMotionRef.current = reducedMotion
  const cancelMotionRef = useRef<(() => void) | null>(null)
  const id = useId()
  const [rail, setRail] = useState({ previous: false, next: false, pages: [0], active: 0, progress: 0 })
  const [scrubbing, setScrubbing] = useState(false)
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    let pages = [0]
    let maximum = 0
    const scroll = () => {
      const left = Math.max(0, Math.min(maximum, viewport.scrollLeft))
      const nearest = nearestRailPosition(pages, left)
      setRail(current => ({ ...current, previous: left > 1, next: left < maximum - 1,
        active: pages.indexOf(nearest), progress: railProgress(pages, left) }))
    }
    const measure = () => {
      const layout = measureRail(viewport)
      pages = layout.pages
      maximum = layout.maximum
      setRail(current => ({ ...current, pages }))
      scroll()
    }
    const stopObserving = observeHorizontalCardRail(viewport, scroll, measure)
    const dragging = bindRailDrag(viewport, () => reducedMotionRef.current)
    cancelMotionRef.current = dragging.cancel
    return () => { stopObserving(); dragging.dispose(); cancelMotionRef.current = null }
  }, [children])

  const goTo = (index: number, immediate = false) => {
    cancelMotionRef.current?.()
    viewportRef.current?.scrollTo({ left: rail.pages[index], behavior: immediate || reducedMotion ? 'instant' : 'smooth' })
  }
  const scrub = (clientX: number, immediate = true) => {
    const bounds = navigationRef.current?.getBoundingClientRect()
    if (!bounds) return
    const progress = Math.max(0, Math.min(1, (clientX - bounds.left - 10) / (bounds.width - 20)))
    goTo(Math.round(progress * (rail.pages.length - 1)), immediate)
  }
  const markers = Math.min(rail.pages.length, 9)

  return (
    <div className={styles.rail}>
      <div
        ref={viewportRef}
        id={id}
        className={[styles.viewport, rail.previous && styles.fadeLeft, rail.next && styles.fadeRight, className].filter(Boolean).join(' ')}
        tabIndex={0}
        data-arrow-navigation
        onKeyDown={event => {
          if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
          if (event.target === event.currentTarget) {
            const index = event.key === 'Home' ? 0 : event.key === 'End' ? rail.pages.length - 1
              : event.key === 'ArrowRight' ? Math.min(rail.active + 1, rail.pages.length - 1)
                : event.key === 'ArrowLeft' ? Math.max(0, rail.active - 1) : -1
            if (index >= 0) { event.preventDefault(); event.stopPropagation(); goTo(index) }
          }
          if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) event.stopPropagation()
        }}
        role="group"
        aria-label={label}
      >
        {children}
      </div>
      {rail.pages.length > 1 && <div className={styles.navigationRow}>
        <div className={styles.navigation} data-scrubbing={scrubbing}>
          <div
            ref={navigationRef}
            className={styles.position}
            style={{ width: (markers - 1) * 20 + 20 }}
            role="slider"
            tabIndex={0}
            aria-label={`${label}，浏览位置`}
            aria-controls={id}
            aria-valuemin={1}
            aria-valuemax={rail.pages.length}
            aria-valuenow={rail.active + 1}
            aria-valuetext={`第 ${rail.active + 1} 组，共 ${rail.pages.length} 组`}
            aria-orientation="horizontal"
            data-arrow-navigation
            onPointerDown={event => {
              if (event.button !== 0 || event.isPrimary === false) return
              event.preventDefault()
              event.currentTarget.focus({ preventScroll: true })
              event.currentTarget.setPointerCapture(event.pointerId)
              cancelMotionRef.current?.()
              scrubGestureRef.current = { start: event.clientX, moved: false }
              setScrubbing(true)
            }}
            onPointerMove={event => {
              const gesture = scrubGestureRef.current
              if (!gesture || !event.currentTarget.hasPointerCapture(event.pointerId)) return
              if (!gesture.moved && Math.abs(event.clientX - gesture.start) < 4) return
              gesture.moved = true
              scrub(event.clientX)
            }}
            onPointerUp={event => {
              if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
              if (!scrubGestureRef.current?.moved) scrub(event.clientX, false)
              scrubGestureRef.current = null
              event.currentTarget.releasePointerCapture(event.pointerId)
              setScrubbing(false)
            }}
            onPointerCancel={() => { scrubGestureRef.current = null; setScrubbing(false) }}
            onLostPointerCapture={() => { scrubGestureRef.current = null; setScrubbing(false) }}
            onKeyDown={event => {
              if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
              const index = event.key === 'Home' ? 0 : event.key === 'End' ? rail.pages.length - 1
                : ['ArrowRight', 'ArrowUp'].includes(event.key) ? Math.min(rail.active + 1, rail.pages.length - 1)
                  : ['ArrowLeft', 'ArrowDown'].includes(event.key) ? Math.max(0, rail.active - 1) : -1
              if (index >= 0) { event.preventDefault(); event.stopPropagation(); goTo(index) }
            }}
          >
            <span className={styles.markers} aria-hidden="true">
              {Array.from({ length: markers }, (_, index) => <span key={index} style={{ transform: `translateX(${index * 20}px)` }} />)}
              <span className={styles.indicator} style={{ transform: `translateX(${rail.progress * (markers - 1) * 20}px)` }} />
            </span>
          </div>
          <span className={styles.count} aria-hidden="true"><strong>{String(rail.active + 1).padStart(2, '0')}</strong><span>/</span>{String(rail.pages.length).padStart(2, '0')}</span>
        </div>
      </div>}
    </div>
  )
}
