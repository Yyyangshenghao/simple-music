import { app, BrowserWindow, screen } from 'electron'
import { bootServer, shutdownServer } from './server-host'
import {
  createMainWindow,
  focusMainWindow,
  scheduleWindowStateSend,
  getMainWindow
} from './modules/window-manager'
import { positionDesktopLyricsWindow, positionWallpaperWindow, closeOverlays } from './modules/overlay-manager'
import { unregisterHotkeys } from './modules/hotkey-manager'
import { registerIpc } from './ipc'

const APP_NAME = 'Simple Music'
const APP_USER_MODEL_ID = 'com.simplemusic.desktop'

// Chromium 性能开关（ANGLE 后端按平台选择）。
const performanceSwitches: Array<[string, string?]> = [
  ['autoplay-policy', 'no-user-gesture-required'],
  ['ignore-gpu-blocklist'],
  ['enable-gpu-rasterization'],
  ['enable-zero-copy'],
  ['disable-background-timer-throttling'],
  ['disable-renderer-backgrounding'],
  ['disable-backgrounding-occluded-windows']
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
  const port = await bootServer()
  createMainWindow(port)
}

if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!focusMainWindow()) {
      app.whenReady().then(boot).catch((e) => console.error('Second instance restore failed:', e))
    }
  })

  app.whenReady().then(async () => {
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
    else focusMainWindow()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    unregisterHotkeys()
    closeOverlays()
    shutdownServer()
  })
}
