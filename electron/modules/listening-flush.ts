import { randomUUID } from 'node:crypto'
import { ipcMain, type BrowserWindow, type IpcMainEvent } from 'electron'

/** 先等主窗口补报，再关闭本地 API；异常或无回执最多等待 1.8 秒。 */
export function flushRendererListeningReports(win: BrowserWindow | null): Promise<void> {
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return Promise.resolve()
  const contents = win.webContents
  const frame = contents.mainFrame
  const id = randomUUID()
  return new Promise((resolve) => {
    const finish = (): void => {
      clearTimeout(timer)
      ipcMain.removeListener('playback:listening-flushed', receive)
      resolve()
    }
    const receive = (event: IpcMainEvent, requestId: unknown): void => {
      if (requestId === id && event.sender === contents && event.senderFrame === frame
        && !contents.isDestroyed() && contents.mainFrame === frame) finish()
    }
    const timer = setTimeout(finish, 1800)
    ipcMain.on('playback:listening-flushed', receive)
    try { contents.send('playback:flush-listening', id) } catch { finish() }
  })
}
