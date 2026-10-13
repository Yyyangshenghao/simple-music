import { useVisualStore } from '../stores/visual'
import { useGameModeStore } from '../stores/game-mode'

let stopWallpaperSync: (() => void) | undefined

/** 宿主持有壁纸参数同步；开关与窗口恢复仍由主进程管理。 */
export function initWallpaperSync(): () => void {
  if (stopWallpaperSync) return stopWallpaperSync
  const desktop = window.desktop
  if (!desktop?.updateWallpaper) return () => {}
  let stopped = false
  const sync = () => {
    if (stopped || useGameModeStore.getState().enabled) return
    void desktop.updateWallpaper({ ...useVisualStore.getState().fx }).catch(() => {})
  }
  const stopVisual = useVisualStore.subscribe((state, previous) => {
    if (state.fx !== previous.fx) sync()
  })
  const stopGame = useGameModeStore.subscribe((state, previous) => {
    // 每次确认都补发完整配置，避免重建窗口或快速进退后仍显示暂停前的参数。
    if (state.enabled !== previous.enabled || state.sequence !== previous.sequence) sync()
  })
  sync()
  stopWallpaperSync = () => {
    if (stopped) return
    stopped = true
    stopVisual()
    stopGame()
    stopWallpaperSync = undefined
  }
  return stopWallpaperSync
}
