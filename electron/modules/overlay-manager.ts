import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import { getMainWindow, resolveRendererUrl, hideMainWindow, focusMainWindow, isInAppUrl } from './window-manager'
import { openExternalSafely } from './safe-open'
import { createLyricsNativeBackdrop } from './lyrics-native-backdrop'
import { preventLyricsActivation } from './macos-lyrics-window'
import { miniPlayerPatch } from '../../src/lib/mini-player-state'
import { getPlatform } from '../platform'
import { desktopLyricsHeight, desktopLyricsSize, DESKTOP_LYRICS_MAX_SIZE, DESKTOP_LYRICS_MIN_SIZE } from '../../src/lib/desktop-lyrics-layout'
import type { LyricsPayload, WallpaperPayload, MiniPlayerPayload, HotBounds, OkResult } from '../../src/types/ipc'

const platform = getPlatform()

let lyricsWindow: BrowserWindow | null = null
let lyricsBackdrop: ReturnType<typeof createLyricsNativeBackdrop> = null
let lyricsBackdropAttempted = false
let lyricsState: LyricsPayload = {}
let lyricsUserBounds: Electron.Rectangle | null = null
let lyricsManualWidth: number | null = null
let lyricsRequestedSize: { width: number; height: number } | null = null
let lyricsProgrammaticMove = false
let lyricsPointerCapture = false
let lyricsMouseIgnored: boolean | null = null
let lyricsHotBounds: HotBounds | null = null
let lyricsControlBounds: HotBounds | null = null
let lyricsHoverBounds: HotBounds | null = null
let lyricsHoverStartedAt: number | null = null
let lyricsUnlockVisible = false
let lyricsControlTimer: ReturnType<typeof setInterval> | null = null
let lyricsLastMiddleAt = 0

let wallpaperWindow: BrowserWindow | null = null
let wallpaperState: WallpaperPayload = {}

let miniPlayerWindow: BrowserWindow | null = null
let miniPlayerState: MiniPlayerPayload = {}
let miniPlayerUserBounds: Electron.Rectangle | null = null
let miniPlayerProgrammaticMove = false

const MINI_PLAYER_MIN_WIDTH = 300
const MINI_PLAYER_MAX_WIDTH = 760
const MINI_PLAYER_DEFAULT_WIDTH = 360
const MINI_PLAYER_MAX_RESIZE_DELTA = MINI_PLAYER_MAX_WIDTH - MINI_PLAYER_MIN_WIDTH
/** 常态高度：64px 条体 + 8px 上下留白（阴影用）。 */
const MINI_PLAYER_BASE_HEIGHT = 80
/** 音量弹层展开时的高度；不常驻是因为透明留白区在 OS 层面同样会挡住桌面点击。 */
const MINI_PLAYER_POPOVER_HEIGHT = 136
let miniPlayerWidth = MINI_PLAYER_DEFAULT_WIDTH
let miniPlayerPopoverOpen = false

/** 悬浮窗同样挂着 preload 桥,导航离开入口页就等于把桥交给外部页面:与主窗口用同一套防护。 */
function hardenOverlayWindow(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafely(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (isInAppUrl(url)) return
    event.preventDefault()
    openExternalSafely(url)
  })
}

function miniPlayerHeight(): number {
  return miniPlayerPopoverOpen ? MINI_PLAYER_POPOVER_HEIGHT : MINI_PLAYER_BASE_HEIGHT
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

const overlayPreload = () => join(import.meta.dirname, '../preload/overlay.cjs')

// ---------- 桌面歌词 ----------
function lyricsContentHeight(payload: LyricsPayload, zoom = 1): number {
  return Math.ceil(desktopLyricsHeight(clampNumber(payload.size, DESKTOP_LYRICS_MIN_SIZE, DESKTOP_LYRICS_MAX_SIZE, 38), !!payload.translation, !!payload.roma, !!payload.nextLine) * zoom - 0.000001)
}

function lyricsDefaultBounds(payload: LyricsPayload): Electron.Rectangle {
  const display = lyricsUserBounds ? screen.getDisplayMatching(lyricsUserBounds) : screen.getPrimaryDisplay()
  const b = display.workArea
  const yRatio = clampNumber(payload.y, 0.08, 0.92, 0.76)
  const width = Math.round(Math.min(680, b.width - 48))
  const height = Math.min(lyricsContentHeight(payload, lyricsWindow?.webContents.getZoomFactor()), b.height)
  return {
    x: Math.round(b.x + (b.width - width) / 2),
    y: Math.round(b.y + b.height * yRatio - height / 2),
    width,
    height
  }
}

function constrainLyricsBounds(bounds: Electron.Rectangle, area = screen.getDisplayMatching(bounds).workArea): Electron.Rectangle {
  const width = Math.round(Math.min(Math.max(180, bounds.width), area.width))
  const minHeight = lyricsContentHeight({ ...lyricsState, size: DESKTOP_LYRICS_MIN_SIZE }, lyricsWindow?.webContents.getZoomFactor())
  const height = Math.round(Math.min(Math.max(minHeight, bounds.height), area.height))
  const maxX = area.x + Math.max(0, area.width - width)
  const maxY = area.y + Math.max(0, area.height - height)
  return {
    width,
    height,
    x: Math.round(clampNumber(bounds.x, area.x, maxX, area.x)),
    y: Math.round(clampNumber(bounds.y, area.y, maxY, area.y))
  }
}

function updateLyricsBackdrop(): void {
  if (!lyricsWindow || lyricsWindow.isDestroyed()) return
  if (lyricsState.backgroundStyle === 'frosted' && !lyricsBackdropAttempted) {
    lyricsBackdropAttempted = true
    const win = lyricsWindow
    lyricsBackdrop = createLyricsNativeBackdrop(win, () => {
      if (lyricsWindow !== win) return
      lyricsBackdrop = null
      sendLyricsState()
    })
  }
  if (lyricsBackdrop?.update({
    visible: lyricsState.backgroundStyle === 'frosted',
    opacity: clampNumber(lyricsState.backgroundOpacity, 0, 1, 0.68)
  }) === false) lyricsBackdrop = null
}

function disposeLyricsBackdrop(): void {
  lyricsBackdrop?.dispose()
  lyricsBackdrop = null
  lyricsBackdropAttempted = false
}

function getLyricsBounds(win: BrowserWindow): Electron.Rectangle {
  // 位置仍读系统值；尺寸由应用控制，不能反复读回取整后的值再用于下一次设置。
  return { ...win.getBounds(), ...lyricsRequestedSize }
}

function setLyricsBounds(bounds: Electron.Rectangle, area?: Electron.Rectangle): void {
  if (!lyricsWindow || lyricsWindow.isDestroyed()) return
  const next = constrainLyricsBounds(bounds, area)
  const cur = lyricsWindow.getBounds()
  lyricsRequestedSize = { width: next.width, height: next.height }
  if (cur.x === next.x && cur.y === next.y && cur.width === next.width && cur.height === next.height) return
  lyricsProgrammaticMove = true
  // 与迷你窗一致：macOS 非 resizable 窗口改尺寸前需要临时放开。
  const needUnlock = process.platform === 'darwin' && (next.width !== cur.width || next.height !== cur.height)
  if (needUnlock) lyricsWindow.setResizable(true)
  lyricsWindow.setBounds(next, false)
  if (needUnlock) lyricsWindow.setResizable(false)
  updateLyricsBackdrop()
  setTimeout(() => {
    lyricsProgrammaticMove = false
  }, 120)
}

function rememberLyricsBounds(): void {
  if (!lyricsWindow || lyricsWindow.isDestroyed() || lyricsProgrammaticMove) return
  lyricsUserBounds = getLyricsBounds(lyricsWindow)
}

function syncLyricsSize(): void {
  if (!lyricsWindow || lyricsWindow.isDestroyed()) return
  const size = desktopLyricsSize(getLyricsBounds(lyricsWindow).height / lyricsWindow.webContents.getZoomFactor(), !!lyricsState.translation, !!lyricsState.roma, !!lyricsState.nextLine)
  if (Math.abs(size - (lyricsState.size ?? 38)) < 0.01) return
  lyricsState = { ...lyricsState, size }
  const main = getMainWindow()
  if (main && !main.isDestroyed()) main.webContents.send('lyrics:size-changed', { size })
}

function stopLyricsControlPoller(): void {
  if (lyricsControlTimer) clearInterval(lyricsControlTimer)
  lyricsControlTimer = null
}

function lyricsBoundsOnScreen(bounds: HotBounds | null): Electron.Rectangle | null {
  if (!lyricsWindow || !bounds) return null
  const b = getLyricsBounds(lyricsWindow)
  return { x: b.x + bounds.left, y: b.y + bounds.top, width: bounds.right - bounds.left, height: bounds.bottom - bounds.top }
}

function applyLyricsMouseBehavior(): void {
  if (!lyricsWindow || lyricsWindow.isDestroyed()) {
    stopLyricsControlPoller()
    return
  }
  const locked = lyricsState.clickThrough !== false
  if (locked && !lyricsControlTimer) {
    // 全窗穿透时无法依赖 pointerenter；仅锁定期间检查系统光标的歌词悬停及解锁热区。
    lyricsControlTimer = setInterval(applyLyricsMouseBehavior, 50)
    lyricsControlTimer.unref()
  } else if (!locked) stopLyricsControlPoller()
  const cursor = screen.getCursorScreenPoint()
  const controls = lyricsBoundsOnScreen(lyricsControlBounds)
  const hover = lyricsBoundsOnScreen(lyricsHoverBounds)
  let visible = lyricsUnlockVisible
  if (!locked || !hover || !controls) {
    lyricsHoverStartedAt = null
    visible = false
  } else if (visible && hover && controls) {
    // 保留歌词到图标之间的移动通道，避免光标途经透明间隙时图标消失。
    const x = Math.min(hover.x, controls.x)
    const y = Math.min(hover.y, controls.y)
    visible = pointInBounds(cursor, {
      x, y,
      width: Math.max(hover.x + hover.width, controls.x + controls.width) - x,
      height: Math.max(hover.y + hover.height, controls.y + controls.height) - y
    })
    if (!visible) lyricsHoverStartedAt = null
  } else if (pointInBounds(cursor, hover)) {
    lyricsHoverStartedAt ??= Date.now()
    visible = Date.now() - lyricsHoverStartedAt >= 500
  } else {
    lyricsHoverStartedAt = null
    visible = false
  }
  if (visible !== lyricsUnlockVisible) {
    lyricsUnlockVisible = visible
    sendLyricsState()
  }
  const shouldIgnore = locked && !(visible && pointInBounds(cursor, controls))
  if (lyricsMouseIgnored === shouldIgnore) return
  lyricsMouseIgnored = shouldIgnore
  lyricsWindow.setIgnoreMouseEvents(shouldIgnore, { forward: true })
}

function lyricsHotBoundsOnScreen(): Electron.Rectangle | null {
  if (!lyricsWindow || lyricsWindow.isDestroyed()) return null
  const wb = getLyricsBounds(lyricsWindow)
  const rel = lyricsHotBounds
  if (!rel) return wb
  return { x: wb.x + rel.left, y: wb.y + rel.top, width: Math.max(1, rel.right - rel.left), height: Math.max(1, rel.bottom - rel.top) }
}

function pointInBounds(point: Electron.Point, bounds: Electron.Rectangle | null): boolean {
  if (!bounds) return false
  return point.x >= bounds.x && point.x <= bounds.x + bounds.width && point.y >= bounds.y && point.y <= bounds.y + bounds.height
}

function handleMiddleClick(): void {
  if (!lyricsWindow || lyricsWindow.isDestroyed() || !lyricsState.enabled) return
  const now = Date.now()
  if (now - lyricsLastMiddleAt < 260) return
  if (!pointInBounds(screen.getCursorScreenPoint(), lyricsHotBoundsOnScreen())) return
  lyricsLastMiddleAt = now
  const nextLocked = lyricsState.clickThrough === false
  lyricsState = { ...lyricsState, clickThrough: nextLocked }
  lyricsPointerCapture = !nextLocked
  applyLyricsMouseBehavior()
  broadcastLyricsLockState()
}

function broadcastLyricsLockState(): void {
  const locked = lyricsState.clickThrough !== false
  const main = getMainWindow()
  if (main && !main.isDestroyed()) main.webContents.send('lyrics:lock-state-changed', { locked })
  sendLyricsState()
}

function broadcastLyricsEnabledState(enabled: boolean, requested = false): void {
  const main = getMainWindow()
  if (main && !main.isDestroyed()) main.webContents.send('lyrics:enabled-state-changed', { enabled, ...(requested ? { requested: true } : {}) })
}

function sendLyricsState(): void {
  if (!lyricsWindow || lyricsWindow.isDestroyed()) return
  lyricsWindow.webContents.send('overlay:lyrics-state', { ...lyricsState, unlockVisible: lyricsUnlockVisible, nativeGlass: !!lyricsBackdrop })
}

export function positionDesktopLyricsWindow(payload: LyricsPayload = lyricsState, force = false): void {
  if (!lyricsWindow || lyricsWindow.isDestroyed()) return
  const useManual = lyricsUserBounds && !force
  setLyricsBounds(useManual && lyricsUserBounds
    ? { ...lyricsUserBounds, height: lyricsContentHeight(payload, lyricsWindow.webContents.getZoomFactor()) }
    : lyricsDefaultBounds(payload))
}

function createLyricsWindow(payload: LyricsPayload): BrowserWindow {
  const prevAutoWidth = lyricsState.autoWidth === true
  const prevY = lyricsState.y
  const prevSize = lyricsState.size
  const prevHasNextLine = !!lyricsState.nextLine
  const prevSecondaryLines = Number(!!lyricsState.translation) + Number(!!lyricsState.roma)
  lyricsState = { ...lyricsState, ...payload, enabled: true }
  if (lyricsState.clickThrough !== false) lyricsPointerCapture = false
  const hasY = Object.prototype.hasOwnProperty.call(payload, 'y')
  const nextY = clampNumber(lyricsState.y, 0.08, 0.92, 0.76)
  const yChanged = hasY && Number.isFinite(Number(prevY)) && Math.abs(nextY - clampNumber(prevY, 0.08, 0.92, 0.76)) > 0.001
  if (yChanged) lyricsUserBounds = null

  if (lyricsWindow && !lyricsWindow.isDestroyed()) {
    if (!prevAutoWidth && lyricsState.autoWidth) lyricsManualWidth = getLyricsBounds(lyricsWindow).width
    if (prevAutoWidth && !lyricsState.autoWidth && lyricsManualWidth !== null) {
      const bounds = getLyricsBounds(lyricsWindow)
      setLyricsBounds({ ...bounds, width: lyricsManualWidth, x: bounds.x + (bounds.width - lyricsManualWidth) / 2 })
      if (lyricsUserBounds) lyricsUserBounds = getLyricsBounds(lyricsWindow)
    }
    if (yChanged) positionDesktopLyricsWindow(lyricsState, true)
    const sizeChanged = typeof payload.size === 'number' && payload.size !== prevSize
    const secondaryLinesChanged = Number(!!lyricsState.translation) + Number(!!lyricsState.roma) !== prevSecondaryLines || !!lyricsState.nextLine !== prevHasNextLine
    // 内容行数变化只调整窗口高度；仅用户主动缩放才反推字号。
    if (sizeChanged || secondaryLinesChanged) {
      const bounds = getLyricsBounds(lyricsWindow)
      setLyricsBounds({ ...bounds, height: lyricsContentHeight(lyricsState, lyricsWindow.webContents.getZoomFactor()) })
      if (lyricsUserBounds) lyricsUserBounds = getLyricsBounds(lyricsWindow)
    }
    updateLyricsBackdrop()
    applyLyricsMouseBehavior()
    sendLyricsState()
    return lyricsWindow
  }

  const win = new BrowserWindow({
    width: 920,
    height: 190,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: true,
    focusable: false,
    ...(process.platform === 'darwin' ? { type: 'panel', acceptFirstMouse: true } : {}),
    skipTaskbar: true,
    show: false,
    title: 'Simple Music Desktop Lyrics',
    // Windows 原生厚边框会引入尺寸偏差，拖动时 getBounds / setBounds 反复累加。
    // 歌词使用自绘缩放手柄，无需系统边框。
    ...(process.platform === 'win32' ? { thickFrame: false } : {}),
    // 歌词窗置顶常驻可见,不会被节流;不再给后台豁免,锁屏/显示器关闭时按默认节流降耗
    webPreferences: { preload: overlayPreload(), contextIsolation: true, nodeIntegration: false, sandbox: true }
  })
  lyricsWindow = win
  preventLyricsActivation(win)
  hardenOverlayWindow(win)
  try {
    lyricsWindow.setAlwaysOnTop(true, 'screen-saver')
    lyricsWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  } catch (e) {
    console.warn('Desktop lyrics topmost setup skipped:', (e as Error).message)
  }
  platform.startMousePoller(handleMiddleClick)
  applyLyricsMouseBehavior()
  positionDesktopLyricsWindow(lyricsState, yChanged || !lyricsUserBounds)
  if (!lyricsState.autoWidth && lyricsManualWidth !== null) {
    const bounds = getLyricsBounds(lyricsWindow)
    setLyricsBounds({ ...bounds, width: lyricsManualWidth, x: bounds.x + (bounds.width - lyricsManualWidth) / 2 })
    if (lyricsUserBounds) lyricsUserBounds = getLyricsBounds(lyricsWindow)
  }
  if (lyricsUserBounds && typeof payload.size === 'number') {
    setLyricsBounds({ ...getLyricsBounds(lyricsWindow), height: lyricsContentHeight(lyricsState, lyricsWindow.webContents.getZoomFactor()) })
  }
  updateLyricsBackdrop()
  lyricsWindow.once('ready-to-show', () => {
    if (lyricsWindow !== win || win.isDestroyed()) return
    win.showInactive()
    sendLyricsState()
  })
  lyricsWindow.webContents.once('did-finish-load', sendLyricsState)
  lyricsWindow.on('closed', () => {
    if (lyricsWindow === win) {
      disposeLyricsBackdrop()
      lyricsWindow = null
      lyricsRequestedSize = null
      lyricsMouseIgnored = null
      lyricsControlBounds = null
      lyricsHoverBounds = null
      lyricsHoverStartedAt = null
      lyricsUnlockVisible = false
      stopLyricsControlPoller()
    }
  })
  lyricsWindow.on('moved', rememberLyricsBounds)
  lyricsWindow.loadURL(resolveRendererUrl('overlays/desktop-lyrics/desktop-lyrics.html')).catch((e) =>
    console.warn('Desktop lyrics load failed:', (e as Error).message)
  )
  return lyricsWindow
}

function closeLyricsWindow(requested = false): void {
  lyricsState = { ...lyricsState, enabled: false }
  lyricsPointerCapture = false
  lyricsMouseIgnored = null
  lyricsHotBounds = null
  lyricsControlBounds = null
  lyricsHoverBounds = null
  lyricsHoverStartedAt = null
  lyricsUnlockVisible = false
  stopLyricsControlPoller()
  disposeLyricsBackdrop()
  platform.stopMousePoller()
  if (lyricsWindow && !lyricsWindow.isDestroyed()) {
    sendLyricsState()
    lyricsWindow.close()
  }
  lyricsWindow = null
  lyricsRequestedSize = null
  broadcastLyricsEnabledState(false, requested)
}

// ---------- 壁纸 ----------
function nativeWindowHandleDecimal(win: BrowserWindow): string {
  const handle = win.getNativeWindowHandle()
  if (process.arch === 'x64') return handle.readBigUInt64LE(0).toString()
  return String(handle.readUInt32LE(0))
}

export function positionWallpaperWindow(): void {
  if (!wallpaperWindow || wallpaperWindow.isDestroyed()) return
  wallpaperWindow.setBounds(screen.getPrimaryDisplay().bounds, false)
}

function sendWallpaperState(): void {
  if (!wallpaperWindow || wallpaperWindow.isDestroyed()) return
  wallpaperWindow.webContents.send('overlay:wallpaper-state', wallpaperState)
}

function createWallpaperWindow(payload: WallpaperPayload): BrowserWindow {
  wallpaperState = { ...wallpaperState, ...payload, enabled: true }
  if (wallpaperWindow && !wallpaperWindow.isDestroyed()) {
    positionWallpaperWindow()
    sendWallpaperState()
    return wallpaperWindow
  }
  const bounds = screen.getPrimaryDisplay().bounds
  wallpaperWindow = new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: false,
    backgroundColor: '#050608',
    hasShadow: false,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    show: false,
    title: 'Simple Music Wallpaper',
    // 壁纸贴桌面底层,被其他窗口完全遮挡是常态,必须关闭后台节流否则动画被节流停摆
    webPreferences: { preload: overlayPreload(), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false }
  })
  hardenOverlayWindow(wallpaperWindow)
  wallpaperWindow.setIgnoreMouseEvents(true, { forward: true })
  wallpaperWindow.once('ready-to-show', () => {
    if (!wallpaperWindow || wallpaperWindow.isDestroyed()) return
    positionWallpaperWindow()
    wallpaperWindow.showInactive()
    platform.attachWallpaperToDesktop(nativeWindowHandleDecimal(wallpaperWindow))
    sendWallpaperState()
  })
  wallpaperWindow.webContents.once('did-finish-load', sendWallpaperState)
  wallpaperWindow.on('closed', () => {
    wallpaperWindow = null
  })
  wallpaperWindow.loadURL(resolveRendererUrl('overlays/wallpaper/wallpaper.html')).catch((e) =>
    console.warn('Wallpaper load failed:', (e as Error).message)
  )
  return wallpaperWindow
}

function closeWallpaperWindow(): void {
  wallpaperState = { ...wallpaperState, enabled: false }
  if (wallpaperWindow && !wallpaperWindow.isDestroyed()) {
    sendWallpaperState()
    wallpaperWindow.close()
  }
  wallpaperWindow = null
}

// ---------- 迷你播放条 ----------
function miniPlayerDefaultBounds(): Electron.Rectangle {
  const area = screen.getPrimaryDisplay().workArea
  return {
    x: Math.round(area.x + area.width - miniPlayerWidth - 24),
    y: Math.round(area.y + area.height - miniPlayerHeight() - 24),
    width: miniPlayerWidth,
    height: miniPlayerHeight()
  }
}

/** 宽度可调、高度锁死；位置夹在所在显示器内。 */
function constrainMiniPlayerBounds(bounds: Electron.Rectangle): Electron.Rectangle {
  const area = screen.getDisplayMatching(bounds).workArea
  const width = Math.round(clampNumber(bounds.width, MINI_PLAYER_MIN_WIDTH, MINI_PLAYER_MAX_WIDTH, MINI_PLAYER_MIN_WIDTH))
  const height = miniPlayerHeight()
  const maxX = area.x + Math.max(0, area.width - width)
  const maxY = area.y + Math.max(0, area.height - height)
  return {
    width,
    height,
    x: Math.round(clampNumber(bounds.x, area.x, maxX, area.x)),
    y: Math.round(clampNumber(bounds.y, area.y, maxY, area.y))
  }
}

function setMiniPlayerBounds(bounds: Electron.Rectangle): void {
  if (!miniPlayerWindow || miniPlayerWindow.isDestroyed()) return
  const next = constrainMiniPlayerBounds(bounds)
  miniPlayerProgrammaticMove = true
  // 非 resizable 窗口在 macOS 上会把 min/max 尺寸钉死在当前值,setBounds 改尺寸会被忽略,故临时放开
  const cur = miniPlayerWindow.getBounds()
  // Windows/Linux 保持关闭原生缩放；拖动右边缘时临时开启会和自绘手柄竞争同一次鼠标手势。
  const needUnlock = process.platform === 'darwin' && (next.width !== cur.width || next.height !== cur.height)
  if (needUnlock) miniPlayerWindow.setResizable(true)
  miniPlayerWindow.setBounds(next, false)
  if (needUnlock) miniPlayerWindow.setResizable(false)
  miniPlayerUserBounds = next
  miniPlayerWidth = next.width
  miniPlayerProgrammaticMove = false
}

function rememberMiniPlayerBounds(): void {
  if (!miniPlayerWindow || miniPlayerWindow.isDestroyed() || miniPlayerProgrammaticMove) return
  const b = miniPlayerWindow.getBounds()
  // moved 只负责记位置。窗口不可由系统边缘缩放，宽度只能由自绘手柄更新；
  // 否则 Windows/DPI 切换时 getBounds 的瞬时宽度漂移会被误当成用户调整并持久化。
  miniPlayerUserBounds = { ...b, width: miniPlayerWidth, height: miniPlayerHeight() }
}

/** 宽度回传主窗口持久化；同一宽度不重复通知。 */
function notifyMiniPlayerWidth(width: number): void {
  const main = getMainWindow()
  if (!main || main.isDestroyed()) return
  main.webContents.send('miniplayer:width-changed', { width })
}

function sendMiniPlayerState(): void {
  if (!miniPlayerWindow || miniPlayerWindow.isDestroyed()) return
  miniPlayerWindow.webContents.send('overlay:miniplayer-state', miniPlayerState)
}

function createMiniPlayerWindow(): BrowserWindow {
  if (miniPlayerWindow && !miniPlayerWindow.isDestroyed()) return miniPlayerWindow

  const win = new BrowserWindow({
    ...(miniPlayerUserBounds ? constrainMiniPlayerBounds(miniPlayerUserBounds) : miniPlayerDefaultBounds()),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    // 尺寸完全由自绘手柄经 setBounds 控制:放开 OS 边缘拖拽会和自绘手柄同帧各改一次宽度，产生抖动
    resizable: false,
    movable: true,
    focusable: true,
    skipTaskbar: true,
    show: false,
    title: 'Simple Music Mini Player',
    // 显式保留 Chromium 默认后台节流,避免迷你条被遮挡时继续高频刷新
    webPreferences: {
      preload: overlayPreload(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: true
    }
  })
  hardenOverlayWindow(win)
  miniPlayerWindow = win
  try {
    win.setAlwaysOnTop(true, 'screen-saver')
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  } catch (e) {
    console.warn('Mini player topmost setup skipped:', (e as Error).message)
  }
  win.once('ready-to-show', () => {
    if (miniPlayerWindow !== win || win.isDestroyed()) return
    // 进入迷你模式时承接主窗口焦点，应用内快捷键才能再次返回完整窗口。
    win.show()
    sendMiniPlayerState()
  })
  win.webContents.on('did-finish-load', () => {
    if (miniPlayerWindow === win && !win.isDestroyed()) sendMiniPlayerState()
  })
  win.on('closed', () => {
    if (miniPlayerWindow !== win) return
    // 系统菜单或 Alt+F4 关闭时也退出迷你模式；显式关闭由各自入口决定是否恢复主窗口。
    miniPlayerWindow = null
    resetMiniPlayerPopover()
    notifyRendererMiniOff()
    focusMainWindow()
  })
  win.on('moved', rememberMiniPlayerBounds)
  win.loadURL(resolveRendererUrl('overlays/mini-player/mini-player.html')).catch((e) =>
    console.warn('Mini player load failed:', (e as Error).message)
  )
  return win
}

function resetMiniPlayerPopover(): void {
  if (miniPlayerPopoverOpen && miniPlayerUserBounds) {
    const bounds = miniPlayerUserBounds
    miniPlayerUserBounds = { ...bounds, y: bounds.y + bounds.height - MINI_PLAYER_BASE_HEIGHT, height: MINI_PLAYER_BASE_HEIGHT }
  }
  miniPlayerPopoverOpen = false
}

function closeMiniPlayerWindow(): void {
  const win = miniPlayerWindow
  miniPlayerWindow = null
  resetMiniPlayerPopover()
  if (win && !win.isDestroyed()) win.close()
}

/** 迷你条与主窗口互斥：开启时把设置开关同步为关（供主进程主动收起迷你时用）。 */
function notifyRendererMiniOff(): void {
  const main = getMainWindow()
  if (main && !main.isDestroyed()) main.webContents.send('miniplayer:control', { action: 'sync-off' })
}

export function setMiniPlayerEnabled(enabled: boolean, width?: number): OkResult {
  if (width !== undefined) {
    miniPlayerWidth = Math.round(clampNumber(width, MINI_PLAYER_MIN_WIDTH, MINI_PLAYER_MAX_WIDTH, MINI_PLAYER_DEFAULT_WIDTH))
    if (miniPlayerUserBounds) miniPlayerUserBounds = { ...miniPlayerUserBounds, width: miniPlayerWidth }
  }
  // 互斥：进入迷你态隐藏主窗口（渲染层据窗口可见性卸载重度可视层降耗），退出时恢复
  if (enabled) {
    createMiniPlayerWindow()
    hideMainWindow()
  } else {
    closeMiniPlayerWindow()
    focusMainWindow()
  }
  return { ok: true }
}

/** 迷你条“回到大播放器”：恢复主窗口 + 关闭迷你条 + 同步设置开关。 */
export function returnFromMiniPlayer(): OkResult {
  closeMiniPlayerWindow()
  notifyRendererMiniOff()
  focusMainWindow()
  return { ok: true }
}

/** 显式退居托盘入口：关闭迷你条、保持主窗口隐藏并继续后台播放。 */
export function hideMiniPlayerToTray(): OkResult {
  closeMiniPlayerWindow()
  notifyRendererMiniOff()
  return { ok: true }
}

export function updateMiniPlayer(payload: MiniPlayerPayload): OkResult {
  const patch = miniPlayerPatch(miniPlayerState, payload)
  if (!Object.keys(patch).length) return { ok: true }
  miniPlayerState = { ...miniPlayerState, ...patch }
  if (miniPlayerWindow && !miniPlayerWindow.isDestroyed()) {
    miniPlayerWindow.webContents.send('overlay:miniplayer-state', patch)
  }
  return { ok: true }
}

export function moveMiniPlayerBy(dx: number, dy: number): OkResult {
  if (!miniPlayerWindow || miniPlayerWindow.isDestroyed()) return { ok: false, error: 'NO_MINI_PLAYER_WINDOW' }
  const b = miniPlayerWindow.getBounds()
  setMiniPlayerBounds({
    ...b,
    x: b.x + Math.round(clampNumber(dx, -200, 200, 0)),
    y: b.y + Math.round(clampNumber(dy, -200, 200, 0)),
    width: miniPlayerWidth,
    height: miniPlayerHeight()
  })
  return { ok: true }
}

/** 右边缘手柄拖拽：只改宽度，左上角不动。 */
export function resizeMiniPlayerBy(dx: number): OkResult {
  if (!miniPlayerWindow || miniPlayerWindow.isDestroyed()) return { ok: false, error: 'NO_MINI_PLAYER_WINDOW' }
  const b = miniPlayerWindow.getBounds()
  const before = miniPlayerWidth
  const delta = Math.round(clampNumber(dx, -MINI_PLAYER_MAX_RESIZE_DELTA, MINI_PLAYER_MAX_RESIZE_DELTA, 0))
  setMiniPlayerBounds({ ...b, width: before + delta })
  if (miniPlayerWidth !== before) notifyMiniPlayerWidth(miniPlayerWidth)
  return { ok: true }
}

/** 音量弹层开合：窗口向上长高，底边保持不动，避免条体跳位。 */
export function setMiniPlayerPopover(open: boolean): OkResult {
  if (!miniPlayerWindow || miniPlayerWindow.isDestroyed()) return { ok: false, error: 'NO_MINI_PLAYER_WINDOW' }
  if (miniPlayerPopoverOpen === open) return { ok: true }
  const b = miniPlayerWindow.getBounds()
  const bottom = b.y + b.height
  miniPlayerPopoverOpen = open
  setMiniPlayerBounds({ ...b, y: bottom - miniPlayerHeight() })
  return { ok: true }
}

export function triggerMiniPlayerControl(action: string, value?: number): OkResult {
  const main = getMainWindow()
  if (!main || main.isDestroyed() || !action) return { ok: false, error: 'NO_MAIN_WINDOW' }
  main.webContents.send('miniplayer:control', { action, value })
  return { ok: true }
}

// ---------- 对外 API（供 ipc 调用） ----------
export function setLyricsEnabled(enabled: boolean, payload: LyricsPayload = {}, requested = false): OkResult {
  if (enabled) {
    createLyricsWindow(payload)
    broadcastLyricsEnabledState(true, requested)
  } else {
    closeLyricsWindow(requested)
  }
  return { ok: true }
}

export function updateLyrics(payload: LyricsPayload = {}): OkResult {
  const next = { ...lyricsState, ...payload }
  // 高频逐字时钟只更新绘制状态，避免重复调整窗口与鼠标穿透。
  if (Object.keys(payload).length === 1 && Object.hasOwn(payload, 'wordClock')) {
    lyricsState = next
    sendLyricsState()
    return { ok: true }
  }
  if (next.enabled) {
    createLyricsWindow(payload)
  } else if (lyricsWindow && !lyricsWindow.isDestroyed()) {
    lyricsState = next
    sendLyricsState()
  } else {
    lyricsState = next
  }
  return { ok: true }
}

export function setLyricsLock(locked: boolean): { ok: boolean; locked: boolean } {
  lyricsState = { ...lyricsState, clickThrough: locked }
  if (locked) lyricsPointerCapture = false
  applyLyricsMouseBehavior()
  broadcastLyricsLockState()
  return { ok: true, locked: lyricsState.clickThrough !== false }
}

export function moveLyricsBy(dx: number, dy: number): OkResult {
  if (!lyricsWindow || lyricsWindow.isDestroyed()) return { ok: false, error: 'NO_DESKTOP_LYRICS_WINDOW' }
  if (lyricsState.clickThrough !== false) return { ok: false, error: 'DESKTOP_LYRICS_LOCKED' }
  const b = getLyricsBounds(lyricsWindow)
  // 拖动跨屏时跟随光标，否则宽窗口会被最大相交的旧显示器一直夹回边缘。
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
  // Windows 非整数 DPI 下读回的尺寸可能取整偏大；移动不能把偏差作为下一帧宽高。
  setLyricsBounds({ ...b, x: Math.round(b.x + clampNumber(dx, -160, 160, 0)), y: Math.round(b.y + clampNumber(dy, -160, 160, 0)) }, area)
  lyricsUserBounds = getLyricsBounds(lyricsWindow)
  return { ok: true }
}

export function resizeLyrics(width: number, height: number, anchor?: 'top-left'): OkResult {
  if (!lyricsWindow || lyricsWindow.isDestroyed()) return { ok: false, error: 'NO_DESKTOP_LYRICS_WINDOW' }
  if (lyricsState.clickThrough !== false) return { ok: false, error: 'DESKTOP_LYRICS_LOCKED' }
  const current = getLyricsBounds(lyricsWindow)
  const area = screen.getDisplayMatching(current).workArea
  const next = constrainLyricsBounds({
    ...current,
    width: clampNumber(width, 280, anchor ? current.x + current.width - area.x : 10000, current.width),
    height: clampNumber(height, 40, anchor ? current.y + current.height - area.y : 10000, current.height)
  }, anchor ? area : undefined)
  // 左上角缩放固定右下角；尺寸到达屏幕或最小值时也不继续移动。
  if (anchor) {
    next.x = current.x + current.width - next.width
    next.y = current.y + current.height - next.height
  }
  setLyricsBounds(next)
  lyricsUserBounds = getLyricsBounds(lyricsWindow)
  lyricsManualWidth = lyricsUserBounds.width
  if (lyricsUserBounds.height !== current.height) syncLyricsSize()
  sendLyricsState()
  return { ok: true }
}

export function setLyricsPointerCapture(active: boolean): OkResult {
  lyricsPointerCapture = active
  applyLyricsMouseBehavior()
  return { ok: true }
}

export function setLyricsHotBounds(bounds: Partial<HotBounds>): OkResult {
  const left = clampNumber(bounds.left, -2000, 4000, 0)
  const top = clampNumber(bounds.top, -2000, 4000, 0)
  const right = clampNumber(bounds.right, left + 1, 6000, left + 1)
  const bottom = clampNumber(bounds.bottom, top + 1, 6000, top + 1)
  lyricsHotBounds = { left, top, right, bottom }
  return { ok: true }
}

export function setLyricsControlBounds(bounds: Partial<HotBounds> & { hover?: HotBounds; contentWidth?: number }): OkResult {
  if (!lyricsWindow || lyricsWindow.isDestroyed()) return { ok: false, error: 'NO_DESKTOP_LYRICS_WINDOW' }
  // DOM 使用 CSS 像素；窗口及系统光标使用 DIP，需计入 Electron 页面缩放。
  const zoom = lyricsWindow.webContents.getZoomFactor()
  const current = getLyricsBounds(lyricsWindow)
  const contentHeight = lyricsContentHeight(lyricsState, zoom)
  const area = screen.getDisplayMatching(current).workArea
  // 文字两侧 64px 内边距 + 窗口留白 12px + 边框 2px。
  const contentWidth = lyricsState.autoWidth && typeof bounds.contentWidth === 'number' && Number.isFinite(bounds.contentWidth) && bounds.contentWidth > 0
    ? Math.min(area.width, Math.max(180, Math.ceil((bounds.contentWidth + 142) * zoom)))
    : current.width
  if (lyricsState.autoWidth && lyricsManualWidth === null) lyricsManualWidth = current.width
  if (current.height !== contentHeight || current.width !== contentWidth) {
    setLyricsBounds({ ...current, width: contentWidth, height: contentHeight,
      x: current.x + (current.width - contentWidth) / 2,
      y: current.y + (current.height - contentHeight) / 2 }, area)
    if (lyricsUserBounds) lyricsUserBounds = getLyricsBounds(lyricsWindow)
    sendLyricsState()
  }
  const { width, height } = getLyricsBounds(lyricsWindow)
  const toDIP = (rect: Partial<HotBounds>): HotBounds | null => {
    const left = clampNumber(Number(rect.left) * zoom, 0, width - 1, 0)
    const top = clampNumber(Number(rect.top) * zoom, 0, height - 1, 0)
    const right = clampNumber(Number(rect.right) * zoom, left, width, left)
    const bottom = clampNumber(Number(rect.bottom) * zoom, top, height, top)
    return right > left && bottom > top ? { left, top, right, bottom } : null
  }
  lyricsControlBounds = toDIP(bounds)
  lyricsHoverBounds = bounds.hover ? toDIP(bounds.hover) : null
  applyLyricsMouseBehavior()
  return { ok: true }
}

export function setWallpaperEnabled(enabled: boolean, payload: WallpaperPayload = {}): OkResult {
  if (enabled) createWallpaperWindow(payload)
  else closeWallpaperWindow()
  return { ok: true }
}

export function updateWallpaper(payload: WallpaperPayload = {}): OkResult {
  wallpaperState = { ...wallpaperState, ...payload }
  if (wallpaperState.enabled) {
    createWallpaperWindow(wallpaperState)
    if (wallpaperWindow && !wallpaperWindow.isDestroyed()) {
      positionWallpaperWindow()
      sendWallpaperState()
    }
  } else if (wallpaperWindow && !wallpaperWindow.isDestroyed()) {
    sendWallpaperState()
  }
  return { ok: true }
}

export function closeOverlays(): void {
  // 应用退出不等于用户关闭歌词；保留下一次启动的开关偏好。
  closeLyricsWindow(true)
  closeWallpaperWindow()
  closeMiniPlayerWindow()
}
