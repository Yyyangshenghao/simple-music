import { createRoot } from 'react-dom/client'
import { useEffect } from 'react'
import { Scene } from '../../src/components/Visualizer/Scene'
import { useVisualStore } from '../../src/stores/visual'
import type { FxParams } from '../../src/types/domain'

function WallpaperApp() {
  useEffect(() => {
    const overlay = window.desktopOverlay
    if (!overlay) return
    return overlay.onWallpaperState((state) => {
      // 壁纸窗口独立进程：用主窗口推送的 fx 更新本地 visual store。
      const { enabled, ...fx } = state as { enabled?: boolean } & Partial<FxParams>
      void enabled
      if (Object.keys(fx).length) useVisualStore.getState().updateFx(fx as Partial<FxParams>)
    })
  }, [])

  return <Scene />
}

createRoot(document.getElementById('root')!).render(<WallpaperApp />)
