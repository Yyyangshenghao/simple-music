import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import styles from './ArtistToolbar.module.css'

interface ArtistToolbarProps {
  children: ReactNode
  className: string
  scrollRef: RefObject<HTMLDivElement>
  active: boolean
  onUserScroll(): void
}

/** 控件始终在同一层，避开页面渐隐蒙版；吸顶时与主导航共用一层玻璃背景。 */
export function ArtistToolbar({ children, className, scrollRef, active, onUserScroll }: ArtistToolbarProps) {
  const onUserScrollRef = useRef(onUserScroll)
  onUserScrollRef.current = onUserScroll
  const anchorRef = useRef<HTMLDivElement>(null)
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
    let frame = 0
    const sync = () => {
      const height = `${layer.offsetHeight}px`
      if (anchor.style.height !== height) anchor.style.height = height
      const rect = anchor.getBoundingClientRect()
      const root = host.getBoundingClientRect()
      const top = parseFloat(getComputedStyle(anchor).top) || 0
      layer.style.top = `${rect.top - root.top}px`
      layer.dataset.artistToolbarPinned = String(rect.top <= root.top + top + 0.5)
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
    syncRef.current = sync
    sync()
    const observer = new ResizeObserver(schedule)
    observerRef.current = observer
    observer.observe(layer)
    observer.observe(viewport)
    viewport.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      layer.removeEventListener('wheel', onWheel)
      syncRef.current = null
      cancelAnimationFrame(frame)
      observerRef.current = null
      observer.disconnect()
      viewport.removeEventListener('scroll', schedule)
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
    const rect = anchor.getBoundingClientRect()
    const bounds = viewport.getBoundingClientRect()
    const top = parseFloat(getComputedStyle(anchor).top) || 0
    const clearance = parseFloat(getComputedStyle(host).getPropertyValue('--sm-player-clearance')) || 0
    if (rect.top < bounds.top + top || rect.bottom > bounds.bottom - clearance) {
      onUserScrollRef.current()
      viewport.scrollTop += rect.top - bounds.top - top
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
