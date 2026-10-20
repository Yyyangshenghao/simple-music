import { ipcMain } from 'electron'
import { getPlaybackHost, isPlaybackHostEvent } from '../modules/playback-host'
import { getAppleMusicCaptureFrame } from '../server-host'

export function registerAppleAudioIpc(): void {
  ipcMain.handle('apple:audio-capture-start', (event): Promise<boolean> => {
    const win = getPlaybackHost()
    if (!win || !isPlaybackHostEvent(event) || !getAppleMusicCaptureFrame()) return Promise.resolve(false)
    // 页面 API 要求用户手势；只给受信后台宿主触发固定的音频频谱采集事件。
    return win.webContents.executeJavaScript("window.dispatchEvent(new Event('simplemusic:apple-audio-capture'))", true)
      .then(() => true, () => false)
  })
}
