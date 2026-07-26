import { app, BrowserWindow, screen, session } from 'electron'
import { bootServer, shutdownServer } from './server-host'
import { createMainWindow, scheduleWindowStateSend, getMainWindow } from './modules/window-manager'
import {
  positionDesktopLyricsWindow,
  positionWallpaperWindow,
  closeOverlays,
  returnFromMiniPlayer
} from './modules/overlay-manager'
import { unregisterHotkeys } from './modules/hotkey-manager'
import { createTray, destroyTray } from './modules/tray-manager'
import { registerIpc } from './ipc'

const APP_NAME = 'Simple Music'
const APP_USER_MODEL_ID = 'com.simplemusic.desktop'

// Chromium 性能开关（ANGLE 后端按平台选择）。
// 不再全局禁用后台节流(disable-*-backgrounding 系列):窗口隐藏/被遮挡后接受 Chromium
// 默认的定时器节流与进程降权,降低后台内存与 CPU;音频走独立 media 管线不受影响。
// 个别窗口按需单独豁免:主窗口 backgroundThrottling:false(window-manager,保证迷你条
// 1Hz 进度同步与播放稳定)、壁纸窗口同设(overlay-manager,贴桌面底层被遮挡是常态)。
const performanceSwitches: Array<[string, string?]> = [
  ['autoplay-policy', 'no-user-gesture-required'],
  ['ignore-gpu-blocklist'],
  ['enable-gpu-rasterization'],
  ['enable-zero-copy'],
  // Chromium 磁盘缓存上限 50MB(主要缓存封面图;音频响应已 no-store)
  ['disk-cache-size', String(50 * 1024 * 1024)]
]
const angle = process.platform === 'win32' ? 'd3d11' : process.platform === 'darwin' ? 'metal' : null
if (angle) performanceSwitches.push(['use-angle', angle])
for (const [name, value] of performanceSwitches) {
  if (value == null) app.commandLine.appendSwitch(name)
  else app.commandLine.appendSwitch(name, value)
}

app.setName(APP_NAME)
if (process.platform === 'win32') app.setAppUserModelId(APP_USER_MODEL_ID)

const gotLock = app.requestSingleInstanceLock()

async function boot(): Promise<void> {
  registerIpc()
  const { port, token } = await bootServer()
  createMainWindow(port, token)
  createTray()
}

if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (getMainWindow()) returnFromMiniPlayer()
    else app.whenReady().then(boot).catch((e) => console.error('Second instance restore failed:', e))
  })

  app.whenReady().then(async () => {
    // 播放器不需要摄像头/麦克风/定位/通知等能力,默认全部拒绝,只留窗口全屏与写剪贴板。
    // Electron 默认是"全部允许",一旦渲染层被注入内容就能直接向系统要这些权限。
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(permission === 'fullscreen' || permission === 'clipboard-sanitized-write')
    })
    screen.on('display-metrics-changed', () => {
      positionDesktopLyricsWindow()
      positionWallpaperWindow()
      scheduleWindowStateSend(getMainWindow())
    })
    screen.on('display-added', () => scheduleWindowStateSend(getMainWindow()))
    screen.on('display-removed', () => scheduleWindowStateSend(getMainWindow()))
    await boot()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) boot()
    else returnFromMiniPlayer()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    unregisterHotkeys()
    closeOverlays()
    destroyTray()
    shutdownServer()
  })
}
