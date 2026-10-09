import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import styles from './ArtistToolbar.module.css'

interface ArtistToolbarProps {
  children: ReactNode
  className: string
  scrollRef: RefObject<HTMLDivElement>
  active: boolean
  onUserScroll(): void
  anchorRef: RefObject<HTMLDivElement>
}

/** 控件始终在同一层，避开页面渐隐蒙版；吸顶时与主导航共用一层玻璃背景。 */
export function ArtistToolbar({ children, className, scrollRef, active, onUserScroll, anchorRef }: ArtistToolbarProps) {
  const onUserScrollRef = useRef(onUserScroll)
  onUserScrollRef.current = onUserScroll
  const layerRef = useRef<HTMLDivElement>(null)
  const observerRef = useRef<ResizeObserver | null>(null)
  const syncRef = useRef<(() => void) | null>(null)
  const [host, setHost] = useState<HTMLElement | null>(null)

  useLayoutEffect(() => {
    setHost(anchorRef.current?.closest<HTMLElement>('[data-app-root]') ?? null)
  }, [])

  useLayoutEffect(() => {
    const anchor = anchorRef.current
    const layer = layerRef.current
    const viewport = scrollRef.current
    if (!host || !anchor || !layer || !viewport || !active) return
    layer.style.removeProperty('top')
    let frame = 0
    let distance = 0
    let scrollable = false
    const onScroll = () => {
      layer.dataset.artistToolbarPinned = String(scrollable && viewport.scrollTop >= distance - 0.5)
    }
    const sync = () => {
      const height = `${layer.offsetHeight}px`
      if (anchor.style.height !== height) anchor.style.height = height
      const rect = anchor.getBoundingClientRect()
      const root = host.getBoundingClientRect()
      const top = parseFloat(getComputedStyle(host).getPropertyValue('--sm-topbar-height')) || 52
      const origin = rect.top - root.top + viewport.scrollTop
      distance = Math.max(0, origin - top)
      scrollable = viewport.scrollHeight > viewport.clientHeight
      layer.dataset.artistToolbarScrollable = String(scrollable)
      layer.style.setProperty('--artist-toolbar-origin', `${origin}px`)
      layer.style.setProperty('--artist-toolbar-sticky-distance', `${distance}px`)
      onScroll()
    }
    const schedule = () => {
      if (frame) return
      frame = requestAnimationFrame(() => { frame = 0; sync() })
    }
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || !event.deltaY) return
      onUserScrollRef.current()
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1
      viewport.scrollTop += event.deltaY * unit
      event.preventDefault()
    }
    layer.addEventListener('wheel', onWheel, { passive: false })
    viewport.style.setProperty('scroll-timeline', '--artist-page block')
    syncRef.current = sync
    sync()
    const observer = new ResizeObserver(schedule)
    observerRef.current = observer
    observer.observe(layer)
    observer.observe(viewport)
    viewport.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      layer.removeEventListener('wheel', onWheel)
      syncRef.current = null
      cancelAnimationFrame(frame)
      observerRef.current = null
      observer.disconnect()
      viewport.style.removeProperty('scroll-timeline')
      viewport.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', schedule)
    }
  }, [host, scrollRef, active])

  // 资料加载、展开简介或切换标签改变占位位置时，在绘制前同步。
  useLayoutEffect(() => {
    const anchor = anchorRef.current
    if (anchor) {
      for (const sibling of Array.from(anchor.parentElement?.children ?? [])) {
        if (sibling === anchor) break
        observerRef.current?.observe(sibling)
      }
    }
    syncRef.current?.()
  })

  function onFocus() {
    const anchor = anchorRef.current
    const viewport = scrollRef.current
    if (!host || !anchor || !viewport) return
    // Portal 不再是滚动区的子节点，聚焦屏幕外输入框时由原页面承接滚动。
    host.scrollTop = 0
    const rect = layerRef.current?.getBoundingClientRect()
    if (!rect) return
    const bounds = viewport.getBoundingClientRect()
    const top = parseFloat(getComputedStyle(host).getPropertyValue('--sm-topbar-height')) || 52
    const clearance = parseFloat(getComputedStyle(host).getPropertyValue('--sm-player-clearance')) || 0
    if (rect.top < bounds.top + top || rect.bottom > bounds.bottom - clearance) {
      onUserScrollRef.current()
      viewport.scrollTop += anchor.getBoundingClientRect().top - bounds.top - top
    }
    syncRef.current?.()
  }

  return <>
    <div ref={anchorRef} className={styles.anchor}>{!host && children}</div>
    {host && active && createPortal(
      <div ref={layerRef} onFocusCapture={onFocus} className={`${styles.layer} ${className}`}>{children}</div>, host
    )}
  </>
}
