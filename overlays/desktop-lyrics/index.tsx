import { createRoot } from 'react-dom/client'
import { useEffect, useRef, useState } from 'react'
import { DesktopLyrics } from '../../src/components/Lyrics/DesktopLyrics'
import type { LyricsPayload } from '../../src/types/ipc'

function asStr(v: unknown): string {
  return typeof v === 'string' ? v : ''
}
function asNum(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function OverlayApp() {
  const [payload, setPayload] = useState<LyricsPayload>({})
  const dragging = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const overlay = window.desktopOverlay
    if (!overlay) return
    return overlay.onLyricsState((p) => setPayload(p))
  }, [])

  // 鼠标进入/离开：解锁状态下允许交互（Windows 生效；mac 为降级 noop）
  const handleEnter = () => window.desktopOverlay?.setLyricsPointerCapture(true)
  const handleLeave = () => {
    window.desktopOverlay?.setLyricsPointerCapture(false)
    dragging.current = null
  }

  const handleDown = (e: React.PointerEvent) => {
    if (payload.clickThrough !== false) return // 锁定态不可拖
    dragging.current = { x: e.screenX, y: e.screenY }
  }
  const handleMove = (e: React.PointerEvent) => {
    if (!dragging.current) return
    const dx = e.screenX - dragging.current.x
    const dy = e.screenY - dragging.current.y
    dragging.current = { x: e.screenX, y: e.screenY }
    window.desktopOverlay?.moveLyricsBy(dx, dy)
  }
  const handleUp = () => {
    dragging.current = null
  }

  return (
    <div
      style={{ width: '100vw', height: '100vh', background: 'transparent' }}
      onPointerEnter={handleEnter}
      onPointerLeave={handleLeave}
      onPointerDown={handleDown}
      onPointerMove={handleMove}
      onPointerUp={handleUp}
    >
      <DesktopLyrics
        line={asStr(payload.line)}
        translation={asStr(payload.translation)}
        size={asNum(payload.size, 38)}
        highlight={payload.highlight !== false}
      />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<OverlayApp />)
