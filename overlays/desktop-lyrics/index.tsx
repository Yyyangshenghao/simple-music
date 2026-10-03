import { createRoot } from 'react-dom/client'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { DesktopLyrics } from '../../src/components/Lyrics/DesktopLyrics'
import type { LyricsPayload } from '../../src/types/ipc'
import styles from './desktop-lyrics.module.css'

function asStr(v: unknown): string {
  return typeof v === 'string' ? v : ''
}
function asNum(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function OverlayApp() {
  const [payload, setPayload] = useState<LyricsPayload>({})
  const dragging = useRef<{ x: number; y: number } | null>(null)
  const resizing = useRef<{ x: number; y: number; width: number; height: number } | null>(null)
  const reportBoundsRef = useRef<(() => void) | null>(null)
  const unlockRef = useRef<HTMLButtonElement>(null)
  const lyricsRef = useRef<HTMLDivElement>(null)
  const locked = payload.clickThrough !== false
  const unlockVisible = locked && payload.unlockVisible === true

  useEffect(() => {
    if (locked) {
      dragging.current = null
      resizing.current = null
    }
  }, [locked])

  useEffect(() => {
    const overlay = window.desktopOverlay
    if (!overlay) return
    return overlay.onLyricsState((p) => setPayload(p))
  }, [])

  useEffect(() => {
    const unlock = unlockRef.current
    const lyrics = lyricsRef.current
    const overlay = window.desktopOverlay
    if (!unlock || !lyrics || !overlay) return
    const textElements = Array.from(lyrics.querySelectorAll('[data-desktop-lyrics-text]'))
    const reportBounds = () => {
      const rects = textElements.map((element) => element.getBoundingClientRect())
      const hover = rects.length ? {
        left: Math.min(...rects.map((r) => r.left)),
        top: Math.min(...rects.map((r) => r.top)),
        right: Math.max(...rects.map((r) => r.right)),
        bottom: Math.max(...rects.map((r) => r.bottom))
      } : undefined
      // 图标紧贴实际文字上沿，字号、翻译变化时也不会留下大段空隙。
      if (hover) unlock.style.top = `${Math.max(2, hover.top - unlock.offsetHeight - 4)}px`
      const { left, top, right, bottom } = unlock.getBoundingClientRect()
      // Range 测量完整文字，避免用已被省略号裁剪的元素宽度。
      const contentWidth = payload.autoWidth && !resizing.current
        ? Math.max(0, ...textElements.map((element) => {
          const range = document.createRange()
          range.selectNodeContents(element)
          return range.getBoundingClientRect().width
        }))
        : undefined
      void overlay.setLyricsControlBounds({ left, top, right, bottom, hover, contentWidth })
    }
    let disposed = false
    let pendingFrame = 0
    const scheduleReport = () => {
      if (disposed) return
      cancelAnimationFrame(pendingFrame)
      pendingFrame = requestAnimationFrame(() => { if (!disposed) reportBounds() })
    }
    reportBoundsRef.current = scheduleReport
    reportBounds()
    // 系统字体完成加载后重新测量，包含中西文字体回退。
    void document.fonts.ready.then(scheduleReport)
    document.fonts.addEventListener('loadingdone', scheduleReport)
    const observer = new ResizeObserver(scheduleReport)
    observer.observe(unlock)
    for (const element of textElements) observer.observe(element)
    window.addEventListener('resize', scheduleReport)
    return () => {
      disposed = true
      reportBoundsRef.current = null
      cancelAnimationFrame(pendingFrame)
      observer.disconnect()
      document.fonts.removeEventListener('loadingdone', scheduleReport)
      window.removeEventListener('resize', scheduleReport)
    }
  }, [locked, payload.line, payload.nextLine, payload.translation, payload.roma, payload.size, payload.fontFamily, payload.fontFamilyCjk, payload.autoWidth])

  const handleEnter = () => window.desktopOverlay?.setLyricsPointerCapture(true)
  const handleLeave = () => {
    if (!dragging.current) window.desktopOverlay?.setLyricsPointerCapture(false)
  }

  const handleDown = (e: React.PointerEvent) => {
    if (payload.clickThrough !== false || e.button !== 0) return
    if ((e.target as Element).closest('button')) return
    e.preventDefault()
    dragging.current = { x: e.screenX, y: e.screenY }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const handleMove = (e: React.PointerEvent) => {
    if (!dragging.current) return
    if (e.buttons === 0) {
      dragging.current = null
      return
    }
    const dx = e.screenX - dragging.current.x
    const dy = e.screenY - dragging.current.y
    dragging.current = { x: e.screenX, y: e.screenY }
    window.desktopOverlay?.moveLyricsBy(dx, dy)
  }
  const handleUp = (e: React.PointerEvent) => {
    dragging.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    if (!e.currentTarget.matches(':hover')) window.desktopOverlay?.setLyricsPointerCapture(false)
  }

  const handleResizeDown = (e: React.PointerEvent) => {
    if (locked || e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    resizing.current = { x: e.screenX, y: e.screenY, width: window.outerWidth, height: window.outerHeight }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const handleResizeMove = (e: React.PointerEvent) => {
    e.stopPropagation()
    const start = resizing.current
    if (!start) return
    if (e.buttons === 0) {
      resizing.current = null
      reportBoundsRef.current?.()
      return
    }
    void window.desktopOverlay?.resizeLyrics(start.width - (e.screenX - start.x), start.height - (e.screenY - start.y), 'top-left')
  }
  const handleResizeUp = (e: React.PointerEvent) => {
    e.stopPropagation()
    resizing.current = null
    reportBoundsRef.current?.()
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
  }

  return (
    <div
      className={`${styles.overlay}${locked ? ` ${styles.locked}` : ''}${unlockVisible ? ` ${styles.unlockVisible}` : ''}`}
      onPointerEnter={handleEnter}
      onPointerLeave={handleLeave}
      onPointerDown={handleDown}
      onPointerMove={handleMove}
      onPointerUp={handleUp}
      onPointerCancel={handleUp}
      onLostPointerCapture={() => { dragging.current = null }}
    >
      <button
        ref={unlockRef}
        className={styles.unlockButton}
        type="button"
        aria-label="解锁桌面歌词"
        aria-hidden={!unlockVisible}
        title="解锁后可拖动或关闭歌词"
        disabled={!unlockVisible}
        onClick={() => window.desktopOverlay?.setLyricsLockState(false)}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="4.5" y="8.5" width="11" height="8" rx="2" /><path d="M7 8.5V6a3 3 0 0 1 5.6-1.5M10 12v1" /></svg>
      </button>
      <div
        ref={lyricsRef}
        className={`${styles.frame}${payload.backgroundStyle === 'frosted' && payload.nativeGlass ? ` ${styles.frosted}` : ''}`}
        style={{ '--frame-opacity': Math.max(0, Math.min(1, asNum(payload.backgroundOpacity, 0.68))) } as CSSProperties}
      >
        {!locked && <button className={styles.lockButton} type="button" aria-label="锁定桌面歌词" title="锁定桌面歌词" onClick={() => window.desktopOverlay?.setLyricsLockState(true)}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="4.5" y="8.5" width="11" height="8" rx="2" /><path d="M7 8.5V6a3 3 0 0 1 6 0v2.5M10 12v1" /></svg>
        </button>}
        {!locked && <button className={styles.closeButton} type="button" aria-label="关闭桌面歌词" title="关闭桌面歌词" onClick={() => window.desktopOverlay?.closeLyrics()}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 6 8 8M14 6l-8 8" /></svg>
        </button>}
        <DesktopLyrics
          line={asStr(payload.line)}
          nextLine={asStr(payload.nextLine)}
          wordLine={payload.wordLine}
          wordClock={payload.wordClock}
          translation={asStr(payload.translation)}
          roma={asStr(payload.roma)}
          size={asNum(payload.size, 38)}
          fontFamily={asStr(payload.fontFamily)}
          fontFamilyCjk={asStr(payload.fontFamilyCjk)}
          color={asStr(payload.color) || '#ffffff'}
          opacity={asNum(payload.opacity, 0.92)}
          fitHeight
          highlight={payload.highlight !== false}
        />
        {!locked && <button
          className={styles.resizeHandle}
          type="button"
          aria-label="调整桌面歌词窗口大小"
          title="拖动左上角调整宽高"
          onPointerDown={handleResizeDown}
          onPointerMove={handleResizeMove}
          onPointerUp={handleResizeUp}
          onPointerCancel={handleResizeUp}
          onLostPointerCapture={() => { resizing.current = null }}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 14 9-9M5 9l4-4" /></svg>
        </button>}
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<OverlayApp />)
