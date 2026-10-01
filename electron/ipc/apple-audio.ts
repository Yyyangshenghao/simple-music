import { ipcMain } from 'electron'
import { getMainWindow } from '../modules/window-manager'
import { getAppleMusicCaptureFrame } from '../server-host'

export function registerAppleAudioIpc(): void {
  ipcMain.handle('apple:audio-capture-start', (event): Promise<boolean> => {
    const win = getMainWindow()
    if (!win || event.sender !== win.webContents || !getAppleMusicCaptureFrame()) return Promise.resolve(false)
    // 页面 API 要求用户手势；只给本应用主窗口触发固定的音频频谱采集事件。
    return win.webContents.executeJavaScript("window.dispatchEvent(new Event('simplemusic:apple-audio-capture'))", true)
      .then(() => true, () => false)
  })
}
