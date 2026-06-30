import { ipcMain } from 'electron'
import {
  getMainWindow,
  getWindowState,
  toggleFullscreen,
  exitFullscreenToWindow
} from '../modules/window-manager'

export function registerWindowIpc(): void {
  ipcMain.handle('window:minimize', () => {
    getMainWindow()?.minimize()
  })
  ipcMain.handle('window:toggle-fullscreen', () => {
    toggleFullscreen(getMainWindow())
  })
  ipcMain.handle('window:exit-fullscreen-windowed', () => {
    exitFullscreenToWindow(getMainWindow())
  })
  ipcMain.handle('window:get-state', () => getWindowState(getMainWindow()))
  ipcMain.handle('window:close', () => {
    getMainWindow()?.close()
  })
  ipcMain.handle('window:maximize', () => {
    const win = getMainWindow()
    if (win?.isMaximized()) win.unmaximize()
    else win?.maximize()
  })
}
