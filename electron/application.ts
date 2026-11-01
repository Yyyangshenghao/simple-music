import { app, screen, session } from 'electron'
import { bootServer, getAppleMusicCaptureFrame, shutdownServer, stopAppleMusicPlayback } from './server-host'
import { createMainWindow, scheduleWindowStateSend, getMainWindow, getServerPort, getServerToken, setMainWindowRestorer, isReleasedMainWindow } from './modules/window-manager'
import {
  positionDesktopLyricsWindow,
  positionWallpaperWindow,
  closeOverlays,
  stopPlaybackOverlays,
  returnFromMiniPlayer
} from './modules/overlay-manager'
import { unregisterHotkeys } from './modules/hotkey-manager'
import { createTray, destroyTray, updateTrayPlayback } from './modules/tray-manager'
import { registerIpc } from './ipc'
import { getGameMode, setGameMode, clearGameModeOverlayRestore } from './modules/game-mode'
import { attachWindowClose } from './modules/window-close'
import { createPlaybackHost, getPlaybackHost, closePlaybackHost, attachPlaybackUi, onPlaybackHostFailure } from './modules/playback-host'
import { flushRendererListeningReports } from './modules/listening-flush'
import { registerKaraokeHelperIpc, stopKaraokeHelper } from './modules/karaoke-helper'
import { cleanupUpdatesOnStartup } from './modules/update-installer'

const gotLock = app.requestSingleInstanceLock()
let isQuitting = false
let quitReady = false
let shutdownStarted = false
let quitTimeout: ReturnType<typeof setTimeout> | undefined

function createPlayerWindow(port: number, token: string): void {
  const win = createMainWindow(port, token)
  attachPlaybackUi(win)
  // Dock、托盘或设置菜单显示主窗口时，统一结束游戏模式。
  win.on('show', () => {
    const mode = getGameMode()
    if (mode.enabled) setGameMode({ ...mode, enabled: false }, false)
  })
  if (process.platform === 'darwin') {
    // 普通关闭保持原有隐藏行为；游戏模式会直接释放 UI，不触发 close。
    win.on('close', (event) => {
      if (isQuitting) return
      event.preventDefault()
      win.hide()
    })
  } else {
    if (process.platform === 'win32') {
      attachWindowClose(win, () => isQuitting)
    }
    // Apple Music 播放窗口会在后台隐藏；主窗口关闭后主动退出，避免只剩后台窗口驻留。
    win.on('closed', () => {
      if (!isQuitting && !isReleasedMainWindow(win)) app.quit()
    })
  }
}

async function boot(): Promise<void> {
  cleanupUpdatesOnStartup()
  registerIpc()
  const { port, token } = await bootServer()
  if (isQuitting) {
    shutdownServer()
    return
  }
  registerKaraokeHelperIpc(port, token)
  onPlaybackHostFailure(() => {
    stopKaraokeHelper()
    clearGameModeOverlayRestore()
    stopPlaybackOverlays()
    void stopAppleMusicPlayback()
    updateTrayPlayback({ title: '播放后台已停止', artist: '', playing: false, hasTrack: false, canSkip: false, volume: 1, desktopLyrics: false })
  })
  const playback = createPlaybackHost(port, token)
  configurePermissions(playback.webContents.session)
  setMainWindowRestorer(() => {
    if (!isQuitting) {
      const mode = getGameMode()
      if (mode.enabled) setGameMode({ enabled: false }, false)
      if (!getMainWindow()) createPlayerWindow(port, token)
    }
  })
  createPlayerWindow(port, token)
  createTray()
}

function configurePermissions(target: Electron.Session): void {
  const allowedPermission = (wc: Electron.WebContents | null, permission: string) =>
    permission === 'fullscreen' || permission === 'clipboard-sanitized-write' ||
    (permission === 'display-capture' && !!wc && wc === getPlaybackHost()?.webContents && !!getAppleMusicCaptureFrame())
  target.setPermissionCheckHandler((wc, permission) => allowedPermission(wc, permission))
  target.setPermissionRequestHandler((wc, permission, callback) => {
    callback(allowedPermission(wc, permission))
  })
  target.setDisplayMediaRequestHandler((request, callback) => {
    const mainFrame = getPlaybackHost()?.webContents.mainFrame
    const appleFrame = getAppleMusicCaptureFrame()
    if (!mainFrame || request.frame !== mainFrame || !request.audioRequested || !request.videoRequested || !appleFrame) {
      // Electron 文档支持 null 拒绝请求，当前类型声明只包含成功流。
      (callback as (streams: Parameters<typeof callback>[0] | null) => void)(null)
      return
    }
    // 捕获 Apple 窗口的音频而不接管输出，MusicKit 仍直接向扬声器播放。
    callback({ video: mainFrame, audio: appleFrame, enableLocalEcho: true })
  })
}

if (!gotLock) {
  app.quit()
} else {
  const startup = app.whenReady().then(async () => {
    // 播放器不需要摄像头/麦克风/定位/通知等能力,只留窗口全屏、写剪贴板和播放宿主的 Apple 音频捕获。
    // Electron 默认是"全部允许",一旦渲染层被注入内容就能直接向系统要这些权限。
    configurePermissions(session.defaultSession)
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
      // 后台/被遮挡窗口未必及时发 show；恢复入口先结束模式，避免重建UI仍被卸载。
      if (getGameMode().enabled) setGameMode({ enabled: false }, false)
      const win = getMainWindow()
      if (!win || win.isDestroyed()) createPlayerWindow(getServerPort(), getServerToken())
      returnFromMiniPlayer()
    }).catch((e) => console.error('Main window restore failed:', e))
  }
  void startup.catch((e) => console.error('Application startup failed:', e))
  app.on('second-instance', restoreMainWindow)
  app.on('activate', restoreMainWindow)

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' && !getGameMode().enabled) app.quit()
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
    stopKaraokeHelper()
    // 应用内后台 MusicKit 窗口承载独立音频，等待关闭后才允许 Electron 退出。
    void (async () => {
      try {
        await flushRendererListeningReports(getPlaybackHost())
        closePlaybackHost()
        await shutdownServer()
      } catch (error) { console.error('Application cleanup failed:', error) }
      finally { quitReady = true; app.quit() }
    })()
  })
  app.on('will-quit', () => clearTimeout(quitTimeout))
}
