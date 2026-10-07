import { ipcMain } from 'electron'
import { setWallpaperEnabled, updateWallpaper } from '../modules/overlay-manager'
import type { WallpaperPayload } from '../../src/types/ipc'
import { getGameMode } from '../modules/game-mode'

export function registerWallpaperIpc(): void {
  ipcMain.handle('wallpaper:set-enabled', (_e, arg: { enabled: boolean; payload?: WallpaperPayload }) =>
    setWallpaperEnabled(!getGameMode().enabled && !!arg?.enabled, arg?.payload ?? {})
  )
  ipcMain.handle('wallpaper:update', (_e, payload: WallpaperPayload) =>
    getGameMode().enabled ? { ok: true } : updateWallpaper(payload ?? {})
  )
}
