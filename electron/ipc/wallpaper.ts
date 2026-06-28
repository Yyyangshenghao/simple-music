import { ipcMain } from 'electron'
import { setWallpaperEnabled, updateWallpaper } from '../modules/overlay-manager'
import type { WallpaperPayload } from '../../src/types/ipc'

export function registerWallpaperIpc(): void {
  ipcMain.handle('wallpaper:set-enabled', (_e, arg: { enabled: boolean; payload?: WallpaperPayload }) =>
    setWallpaperEnabled(!!arg?.enabled, arg?.payload ?? {})
  )
  ipcMain.handle('wallpaper:update', (_e, payload: WallpaperPayload) => updateWallpaper(payload ?? {}))
}
