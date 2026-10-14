import { getMainWindow, hideMainWindow, focusMainWindow, releaseMainWindow } from './window-manager'
import { suspendMiniPlayer, suspendWallpaper, setMiniPlayerEnabled, setWallpaperEnabled } from './overlay-manager'
import { isPlaybackHostReady, sendPlaybackEvent } from './playback-host'
import type { GameModeState } from '../../src/types/ipc'

let state: GameModeState = { enabled: false }
let restoreMiniPlayer = false
let restoreWallpaper = false
const listeners = new Set<() => void>()

export function getGameMode(): GameModeState {
  return { ...state }
}

export function onGameModeChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** 后台失联后不再恢复依赖旧播放状态的窗口，不主动打断游戏。 */
export function clearGameModeOverlayRestore(): void {
  restoreMiniPlayer = false
  restoreWallpaper = false
}

export function setGameMode(next: GameModeState, restoreWindow = true): GameModeState {
  if (state.enabled === !!next.enabled) return getGameMode()
  const entering = next.enabled && !state.enabled
  const leaving = !next.enabled && state.enabled
  state = { enabled: !!next.enabled }
  if (entering) {
    restoreMiniPlayer = suspendMiniPlayer()
    restoreWallpaper = suspendWallpaper()
  }
  if (state.enabled) {
    setWallpaperEnabled(false)
    if (isPlaybackHostReady()) releaseMainWindow()
    else hideMainWindow()
  }
  const main = getMainWindow()
  if (main && !main.isDestroyed()) main.webContents.send('game-mode:state-changed', getGameMode())
  sendPlaybackEvent('game-mode:state-changed', getGameMode())
  listeners.forEach(listener => listener())
  if (leaving) {
    if (restoreWallpaper) setWallpaperEnabled(true)
    restoreWallpaper = false
    const restoreMini = restoreMiniPlayer
    restoreMiniPlayer = false
    if (restoreWindow) {
      if (restoreMini) setMiniPlayerEnabled(true)
      else focusMainWindow()
    }
  }
  return getGameMode()
}
