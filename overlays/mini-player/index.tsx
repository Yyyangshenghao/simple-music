import { createRoot } from 'react-dom/client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { MiniPlayerBar } from '../../src/components/Player/MiniPlayerBar'
import { DEFAULT_MINI_PLAYER_APPEARANCE } from '../../src/lib/mini-player-config'
import type { MiniPlayerPayload } from '../../src/types/ipc'
import './mini-player.css'

function OverlayApp() {
  const [payload, setPayload] = useState<MiniPlayerPayload>({})
  const [width, setWidth] = useState(() => window.innerWidth)
  const dragging = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const overlay = window.desktopOverlay
    if (!overlay) return
    return overlay.onMiniPlayerState((p) => setPayload((prev) => ({ ...prev, ...p })))
  }, [])

  // 宽度由主进程改窗口尺寸驱动,这里只跟随
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const handleDown = (e: React.PointerEvent) => {
    dragging.current = { x: e.screenX, y: e.screenY }
    // 捕获指针,拖快时鼠标跑出窗口也不会丢事件
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const handleMove = (e: React.PointerEvent) => {
    if (!dragging.current) return
    // 同 MiniPlayerBar 的手柄:pointerup 可能丢失,残留状态会让纯悬停也拖动窗口
    if (e.buttons === 0) {
      dragging.current = null
      return
    }
    const dx = e.screenX - dragging.current.x
    const dy = e.screenY - dragging.current.y
    dragging.current = { x: e.screenX, y: e.screenY }
    window.desktopOverlay?.moveMiniPlayerBy(dx, dy)
  }
  const handleUp = (e: React.PointerEvent) => {
    dragging.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
  }

  const control = useCallback(
    (action: string, value?: number) => window.desktopOverlay?.miniPlayerControl(action, value),
    []
  )
  const handlePopoverChange = useCallback((open: boolean) => {
    void window.desktopOverlay?.setMiniPlayerPopover(open)
  }, [])
  const handleResizeBy = useCallback((dx: number) => {
    void window.desktopOverlay?.resizeMiniPlayerBy(dx)
  }, [])

  return (
    <div
      style={{ width: '100%', height: '100%' }}
      onPointerDown={handleDown}
      onPointerMove={handleMove}
      onPointerUp={handleUp}
      onPointerLeave={handleUp}
    >
      <MiniPlayerBar
        trackTitle={payload.trackTitle}
        artistName={payload.artistName}
        coverUrl={payload.coverUrl}
        playing={payload.playing}
        position={payload.position}
        duration={payload.duration}
        volume={payload.volume ?? 1}
        lyricLine={payload.lyricLine}
        accent={payload.accent}
        appearance={payload.appearance ?? DEFAULT_MINI_PLAYER_APPEARANCE}
        width={width}
        onTogglePlay={() => control('play-pause')}
        onPrev={() => control('prev')}
        onNext={() => control('next')}
        onSeek={(sec) => control('seek', sec)}
        onVolume={(v) => control('volume', v)}
        onClose={() => window.desktopOverlay?.closeMiniPlayer()}
        onOpenMain={() => window.desktopOverlay?.focusMainFromMiniPlayer()}
        onResizeBy={handleResizeBy}
        onPopoverChange={handlePopoverChange}
      />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<OverlayApp />)
