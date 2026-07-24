import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import { openExternalSafely } from './safe-open'
import type { WindowState, DisplayBounds } from '../../src/types/ipc'

const APP_NAME = 'Simple Music'
const WINDOWED_ASPECT = 16 / 9
const WINDOWED_SCALE = 3 / 4
const WINDOWED_MARGIN = 32
const MIN_WINDOWED_WIDTH = 960
const MIN_WINDOWED_HEIGHT = 540

let mainWindow: BrowserWindow | null = null
let mainServerPort = 0
let mainServerToken = ''
let htmlFullscreenActive = false
let windowFullscreenActive = false
let stateTimer: NodeJS.Timeout | null = null

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

export function getServerPort(): number {
  return mainServerPort
}

export function getServerToken(): string {
  return mainServerToken
}

/** 解析渲染层入口 URL：dev 走 vite，prod 走打包文件。 */
export function resolveRendererUrl(entry: string): string {
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) return new URL(entry, devUrl.endsWith('/') ? devUrl : `${devUrl}/`).toString()
  return `file://${join(import.meta.dirname, '../renderer', entry)}`
}

/**
 * 目标 URL 是否仍在应用内。dev 下渲染层由 vite 提供，同 origin 即站内；
 * prod 是 file://，限定在打包出的 renderer 目录下，防止导航到磁盘上的其它文件。
 */
export function isInAppUrl(target: string, entry = resolveRendererUrl('index.html')): boolean {
  let url: URL
  let base: URL
  try {
    url = new URL(target)
    base = new URL(entry)
  } catch {
    return false
  }
  if (base.protocol === 'file:') {
    if (url.protocol !== 'file:') return false
    const dir = base.pathname.slice(0, base.pathname.lastIndexOf('/') + 1)
    return url.pathname.startsWith(dir)
  }
  return url.origin === base.origin
}

function rectsOverlapOnY(a: Electron.Rectangle, b: Electron.Rectangle): boolean {
  const aBottom = a.y + a.height
  const bBottom = b.y + b.height
  return aBottom > b.y && bBottom > a.y
}

function getDisplayState(win: BrowserWindow): {
  isPrimaryDisplay: boolean
  hasDisplayOnLeft: boolean
  hasDisplayOnRight: boolean
  displayBounds: DisplayBounds | null
} {
  const displays = screen.getAllDisplays()
  const primary = screen.getPrimaryDisplay()
  const display = win && !win.isDestroyed() ? screen.getDisplayMatching(win.getBounds()) : primary
  const bounds = display.bounds ?? primary.bounds
  const tol = 2
  const hasDisplayOnLeft = displays.some(
    (c) =>
      c.id !== display.id &&
      rectsOverlapOnY(bounds, c.bounds) &&
      Math.abs(c.bounds.x + c.bounds.width - bounds.x) <= tol
  )
  const hasDisplayOnRight = displays.some(
    (c) =>
      c.id !== display.id &&
      rectsOverlapOnY(bounds, c.bounds) &&
      Math.abs(bounds.x + bounds.width - c.bounds.x) <= tol
  )
  return {
    isPrimaryDisplay: display.id === primary.id,
    hasDisplayOnLeft,
    hasDisplayOnRight,
    displayBounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
  }
}

export function getWindowState(win: BrowserWindow | null): WindowState {
  if (!win || win.isDestroyed()) {
    return {
      isMaximized: false,
      isNativeFullScreen: false,
      isHtmlFullScreen: false,
      isWindowFullScreen: false,
      isFullScreen: false,
      isMinimized: false,
      isVisible: false,
      isFocused: false,
      isPrimaryDisplay: true,
      hasDisplayOnLeft: false,
      hasDisplayOnRight: false,
      displayBounds: null
    }
  }
  return {
    isMaximized: win.isMaximized(),
    isNativeFullScreen: win.isFullScreen(),
    isHtmlFullScreen: htmlFullscreenActive,
    isWindowFullScreen: windowFullscreenActive,
    isFullScreen: win.isFullScreen() || htmlFullscreenActive || windowFullscreenActive,
    isMinimized: win.isMinimized(),
    isVisible: win.isVisible(),
    isFocused: win.isFocused(),
    ...getDisplayState(win)
  }
}

export function sendWindowState(win: BrowserWindow | null = mainWindow): void {
  if (!win || win.isDestroyed()) return
  win.webContents.send('window:state-changed', getWindowState(win))
}

export function scheduleWindowStateSend(win: BrowserWindow | null = mainWindow, delay = 80): void {
  if (!win || win.isDestroyed()) return
  if (stateTimer) clearTimeout(stateTimer)
  stateTimer = setTimeout(() => {
    stateTimer = null
    sendWindowState(win)
  }, delay)
}

function getWindowedBounds(win: BrowserWindow | null): Electron.Rectangle {
  const display =
    win && !win.isDestroyed() ? screen.getDisplayMatching(win.getBounds()) : screen.getPrimaryDisplay()
  const area = display.workArea
  const basis = display.bounds ?? area
  const maxWidth = Math.max(640, area.width - WINDOWED_MARGIN)
  const maxHeight = Math.max(360, area.height - WINDOWED_MARGIN)

  let width = Math.round(basis.width * WINDOWED_SCALE)
  let height = Math.round(width / WINDOWED_ASPECT)
  const scaledHeight = Math.round(basis.height * WINDOWED_SCALE)
  if (height > scaledHeight) {
    height = scaledHeight
    width = Math.round(height * WINDOWED_ASPECT)
  }
  if (width < MIN_WINDOWED_WIDTH && maxWidth >= MIN_WINDOWED_WIDTH && maxHeight >= MIN_WINDOWED_HEIGHT) {
    width = MIN_WINDOWED_WIDTH
    height = MIN_WINDOWED_HEIGHT
  }
  if (width > maxWidth) {
    width = maxWidth
    height = Math.round(width / WINDOWED_ASPECT)
  }
  if (height > maxHeight) {
    height = maxHeight
    width = Math.round(height * WINDOWED_ASPECT)
  }
  return {
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + (area.height - height) / 2),
    width,
    height
  }
}

export function applyWindowedBounds(win: BrowserWindow | null): void {
  if (!win || win.isDestroyed()) return
  if (win.isMaximized()) win.unmaximize()
  win.setMinimumSize(MIN_WINDOWED_WIDTH, MIN_WINDOWED_HEIGHT)
  win.setBounds(getWindowedBounds(win), false)
  sendWindowState(win)
}

export function exitFullscreenToWindow(win: BrowserWindow | null): void {
  if (!win || win.isDestroyed()) return
  windowFullscreenActive = false
  if (!win.isFullScreen()) {
    applyWindowedBounds(win)
    return
  }
  let applied = false
  const applyOnce = () => {
    if (applied || !win || win.isDestroyed() || win.isFullScreen()) return
    applied = true
    applyWindowedBounds(win)
  }
  win.once('leave-full-screen', () => setTimeout(applyOnce, 50))
  win.setFullScreen(false)
  setTimeout(applyOnce, 500)
}

export function toggleFullscreen(win: BrowserWindow | null): void {
  if (!win || win.isDestroyed()) return
  if (win.isFullScreen() || windowFullscreenActive) {
    exitFullscreenToWindow(win)
    return
  }
  windowFullscreenActive = true
  win.setFullScreen(true)
  sendWindowState(win)
}

export function focusMainWindow(): boolean {
  if (!mainWindow || mainWindow.isDestroyed()) return false
  if (mainWindow.isMinimized()) mainWindow.restore()
  if (!mainWindow.isVisible()) mainWindow.show()
  mainWindow.focus()
  sendWindowState(mainWindow)
  return true
}

/** 隐藏主窗口（迷你播放条互斥 / 退居托盘用）。窗口仍存活，仅不可见。 */
export function hideMainWindow(): boolean {
  if (!mainWindow || mainWindow.isDestroyed()) return false
  if (!mainWindow.isVisible()) return true
  mainWindow.hide()
  sendWindowState(mainWindow)
  return true
}

export function createMainWindow(serverPort: number, serverToken = ''): BrowserWindow {
  mainServerPort = serverPort
  mainServerToken = serverToken
  htmlFullscreenActive = false
  windowFullscreenActive = false

  const initialBounds = getWindowedBounds(null)
  // macOS 用原生 hiddenInset + 内嵌交通灯；其余平台没有该 API，改用完全无边框窗口，
  // 顶栏自绘的最小化/最大化/关闭按钮见 WindowChrome。
  const platformChrome: Electron.BrowserWindowConstructorOptions =
    process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 14 } }
      : { frame: false }
  mainWindow = new BrowserWindow({
    ...initialBounds,
    minWidth: MIN_WINDOWED_WIDTH,
    minHeight: MIN_WINDOWED_HEIGHT,
    show: false,
    ...platformChrome,
    fullscreen: false,
    backgroundColor: '#0a101c',
    hasShadow: true,
    autoHideMenuBar: true,
    title: APP_NAME,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      additionalArguments: [
        `--simplemusic-server-port=${serverPort}`,
        `--simplemusic-server-token=${serverToken}`
      ]
    }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafely(url)
    return { action: 'deny' }
  })

  // 渲染层不应导航离开应用入口；一旦离开，外部页面就继承了 preload 暴露的 desktop 桥。
  // 站内导航（hash 路由、dev 下的整页重载）放行，其余交给系统浏览器。
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isInAppUrl(url)) return
    event.preventDefault()
    openExternalSafely(url)
  })

  mainWindow.webContents.once('did-finish-load', () => sendWindowState(mainWindow))
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape' && mainWindow?.isFullScreen()) {
      event.preventDefault()
      exitFullscreenToWindow(mainWindow)
    }
  })
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
    sendWindowState(mainWindow)
  })

  const pushState = () => sendWindowState(mainWindow)
  mainWindow.on('maximize', pushState)
  mainWindow.on('unmaximize', pushState)
  mainWindow.on('minimize', pushState)
  mainWindow.on('restore', pushState)
  mainWindow.on('show', pushState)
  mainWindow.on('hide', pushState)
  mainWindow.on('focus', pushState)
  mainWindow.on('blur', pushState)
  mainWindow.on('move', () => scheduleWindowStateSend(mainWindow))
  mainWindow.on('resize', () => scheduleWindowStateSend(mainWindow))
  mainWindow.on('enter-full-screen', () => {
    windowFullscreenActive = true
    sendWindowState(mainWindow)
  })
  mainWindow.on('leave-full-screen', () => {
    windowFullscreenActive = false
    setTimeout(() => applyWindowedBounds(mainWindow), 50)
  })
  mainWindow.on('enter-html-full-screen', () => {
    htmlFullscreenActive = true
    sendWindowState(mainWindow)
  })
  mainWindow.on('leave-html-full-screen', () => {
    htmlFullscreenActive = false
    setTimeout(() => applyWindowedBounds(mainWindow), 50)
  })
  mainWindow.on('closed', () => {
    if (stateTimer) {
      clearTimeout(stateTimer)
      stateTimer = null
    }
    mainWindow = null
  })

  mainWindow.loadURL(resolveRendererUrl('index.html'))
  return mainWindow
}
