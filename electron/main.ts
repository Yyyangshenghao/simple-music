import { app, screen, session } from 'electron'
import { bootServer, shutdownServer } from './server-host'
import { createMainWindow, scheduleWindowStateSend, getMainWindow, getServerPort, getServerToken } from './modules/window-manager'
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
let isQuitting = false
let quitReady = false
let shutdownStarted = false
let quitTimeout: ReturnType<typeof setTimeout> | undefined

function createPlayerWindow(port: number, token: string): void {
  const win = createMainWindow(port, token)
  if (process.platform === 'darwin') {
    // 音频引擎运行在主窗口中；关闭窗口只隐藏，真正退出时才销毁。
    win.on('close', (event) => {
      if (isQuitting) return
      event.preventDefault()
      win.hide()
    })
  } else {
    // Apple Music 播放窗口会在后台隐藏；主窗口关闭后主动退出，避免只剩后台窗口驻留。
    win.on('closed', () => {
      if (!isQuitting) app.quit()
    })
  }
}

async function boot(): Promise<void> {
  registerIpc()
  const { port, token } = await bootServer()
  if (isQuitting) {
    shutdownServer()
    return
  }
  createPlayerWindow(port, token)
  createTray()
}

if (!gotLock) {
  app.quit()
} else {
  const startup = app.whenReady().then(async () => {
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

  // 恢复窗口需等待首次启动完成，不能重新注册 IPC 或以悬浮窗判断主窗口是否存在。
  const restoreMainWindow = () => {
    void startup.then(() => {
      if (isQuitting) return
      const win = getMainWindow()
      if (!win || win.isDestroyed()) createPlayerWindow(getServerPort(), getServerToken())
      returnFromMiniPlayer()
    }).catch((e) => console.error('Main window restore failed:', e))
  }
  void startup.catch((e) => console.error('Application startup failed:', e))
  app.on('second-instance', restoreMainWindow)
  app.on('activate', restoreMainWindow)

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', (event) => {
    if (quitReady) return
    event?.preventDefault()
    if (shutdownStarted) return
    shutdownStarted = true
    isQuitting = true
    // 专用浏览器清理最多约 4.5 秒；再给窗口卸载留出时间，避免退出卡住单实例锁。
    quitTimeout = setTimeout(() => app.exit(0), 8000)
    quitTimeout.unref()
    unregisterHotkeys()
    closeOverlays()
    destroyTray()
    // 应用内后台 MusicKit 窗口承载独立音频，等待关闭后才允许 Electron 退出。
    void (async () => {
      try { await shutdownServer() } catch (error) { console.error('Application cleanup failed:', error) }
      finally { quitReady = true; app.quit() }
    })()
  })
  app.on('will-quit', () => clearTimeout(quitTimeout))
}
