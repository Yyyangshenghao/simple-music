import { useEffect } from 'react'
import { useVisualStore } from '../stores/visual'

// 主窗口把 fx 推送给壁纸 overlay（窗口未开启时主进程仅缓存）。
export function useWallpaperSync(): void {
  const fx = useVisualStore((s) => s.fx)

  useEffect(() => {
    const d = window.desktop
    if (!d) return
    void d.updateWallpaper({ ...fx })
  }, [fx])
}
