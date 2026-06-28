import { ipcMain } from 'electron'
import { getMainWindow } from '../modules/window-manager'
import { openNeteaseLogin, clearNeteaseLogin, openQQLogin, clearQQLogin } from '../modules/login-manager'

export function registerLoginIpc(): void {
  ipcMain.handle('login:netease-open', () => openNeteaseLogin(getMainWindow()))
  ipcMain.handle('login:netease-clear', () => clearNeteaseLogin())
  ipcMain.handle('login:qq-open', () => openQQLogin(getMainWindow()))
  ipcMain.handle('login:qq-clear', () => clearQQLogin())
}
