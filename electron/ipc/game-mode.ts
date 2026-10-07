import { ipcMain } from 'electron'
import { getGameMode, setGameMode } from '../modules/game-mode'
import { updateTrayPlayback } from '../modules/tray-manager'
import type { GameModeState, TrayPlaybackState } from '../../src/types/ipc'

export function registerGameModeIpc(): void {
  ipcMain.handle('game-mode:get-state', () => getGameMode())
  ipcMain.handle('game-mode:set-state', (_event, value: GameModeState) =>
    setGameMode({ enabled: !!value?.enabled })
  )
  ipcMain.handle('tray:update-playback', (_event, value: TrayPlaybackState) => updateTrayPlayback(value))
}
