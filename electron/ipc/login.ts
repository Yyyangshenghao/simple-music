import { ipcMain } from 'electron'
import { getMainWindow } from '../modules/window-manager'
import { openNeteaseLogin, clearNeteaseLogin, openQQLogin, clearQQLogin } from '../modules/login-manager'
import { cancelNeteaseQr, pollNeteaseQr, startNeteaseQr } from '../modules/netease-qr-login'

export function registerLoginIpc(): void {
  ipcMain.handle('login:netease-open', () => openNeteaseLogin(getMainWindow()))
  ipcMain.handle('login:netease-clear', () => clearNeteaseLogin())
  ipcMain.handle('login:qq-open', () => openQQLogin(getMainWindow()))
  ipcMain.handle('login:qq-clear', () => clearQQLogin())
  ipcMain.handle('login:netease-qr-start', () => startNeteaseQr())
  ipcMain.handle('login:netease-qr-poll', () => pollNeteaseQr())
  ipcMain.handle('login:netease-qr-cancel', () => cancelNeteaseQr())
}
