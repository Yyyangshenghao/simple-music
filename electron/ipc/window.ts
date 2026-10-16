import { ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { getWindowCloseState, resolveWindowClose, setWindowCloseBehavior } from '../modules/window-close'
import { isPlaybackHostEvent } from '../modules/playback-host'
import { getGameMode, setGameMode } from '../modules/game-mode'
import { returnFromMiniPlayer } from '../modules/overlay-manager'
import {
  getMainWindow,
  getWindowState,
  setModalOpen,
  toggleFullscreen,
  exitFullscreenToWindow
} from '../modules/window-manager'

export function registerWindowIpc(): void {
  const requireMainFrame = (event: IpcMainInvokeEvent): void => {
    const win = getMainWindow()
    if (process.platform !== 'win32' || !win || win.isDestroyed()
      || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) {
      throw new Error('Window close preferences are only available to the Windows main window')
    }
  }
  ipcMain.handle('window:get-close-state', (event) => {
    requireMainFrame(event)
    return getWindowCloseState()
  })
  ipcMain.handle('window:set-close-behavior', (event, behavior) => {
    requireMainFrame(event)
    return setWindowCloseBehavior(behavior)
  })
  ipcMain.handle('window:resolve-close', (event, choice) => {
    requireMainFrame(event)
    return resolveWindowClose(choice)
  })
  ipcMain.handle('window:show', (event) => {
    if (!isPlaybackHostEvent(event)) throw new Error('Only the playback host can show the main window')
    if (getGameMode().enabled) setGameMode({ enabled: false }, false)
    returnFromMiniPlayer()
  })
  ipcMain.handle('window:set-modal-open', (event, open: unknown) => {
    const win = getMainWindow()
    if (!win || win.isDestroyed() || event.sender !== win.webContents
      || event.senderFrame !== win.webContents.mainFrame) {
      throw new Error('Modal state is only available to the main window')
    }
    if (typeof open !== 'boolean') throw new Error('Invalid modal state')
    setModalOpen(open)
  })
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
