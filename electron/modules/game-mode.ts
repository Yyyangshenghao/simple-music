import { getMainWindow, hideMainWindow, focusMainWindow } from './window-manager'
import { suspendMiniPlayer, suspendWallpaper, setMiniPlayerEnabled, setWallpaperEnabled } from './overlay-manager'
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
    hideMainWindow()
  }
  const main = getMainWindow()
  if (main && !main.isDestroyed()) main.webContents.send('game-mode:state-changed', getGameMode())
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
