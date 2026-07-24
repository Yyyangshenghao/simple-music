import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import { getMainWindow, resolveRendererUrl, hideMainWindow, focusMainWindow, isInAppUrl } from './window-manager'
import { openExternalSafely } from './safe-open'
import { getPlatform } from '../platform'
import type { LyricsPayload, WallpaperPayload, MiniPlayerPayload, HotBounds, OkResult } from '../../src/types/ipc'

const platform = getPlatform()

let lyricsWindow: BrowserWindow | null = null
let lyricsState: LyricsPayload = {}
let lyricsUserBounds: Electron.Rectangle | null = null
let lyricsProgrammaticMove = false
let lyricsPointerCapture = false
let lyricsMouseIgnored: boolean | null = null
let lyricsHotBounds: HotBounds | null = null
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
function lyricsDefaultBounds(payload: LyricsPayload): Electron.Rectangle {
  const display = lyricsUserBounds ? screen.getDisplayMatching(lyricsUserBounds) : screen.getPrimaryDisplay()
  const b = display.bounds
  const yRatio = clampNumber(payload.y, 0.08, 0.92, 0.76)
  const width = Math.round(Math.min(Math.max(880, b.width * 0.72), b.width - 96))
  const height = Math.round(Math.min(Math.max(340, b.height * 0.38), 560, b.height - 96))
  return {
    x: Math.round(b.x + (b.width - width) / 2),
    y: Math.round(b.y + b.height * yRatio - height / 2),
    width,
    height
  }
}

function constrainLyricsBounds(bounds: Electron.Rectangle): Electron.Rectangle {
  const area = screen.getDisplayMatching(bounds).bounds
  const width = Math.round(Math.min(Math.max(320, bounds.width), area.width))
  const height = Math.round(Math.min(Math.max(180, bounds.height), area.height))
  const maxX = area.x + Math.max(0, area.width - width)
  const maxY = area.y + Math.max(0, area.height - height)
  return {
    width,
    height,
    x: Math.round(clampNumber(bounds.x, area.x, maxX, area.x)),
    y: Math.round(clampNumber(bounds.y, area.y, maxY, area.y))
  }
}

function setLyricsBounds(bounds: Electron.Rectangle): void {
  if (!lyricsWindow || lyricsWindow.isDestroyed()) return
  const next = constrainLyricsBounds(bounds)
  const cur = lyricsWindow.getBounds()
  if (cur.x === next.x && cur.y === next.y && cur.width === next.width && cur.height === next.height) return
  lyricsProgrammaticMove = true
  lyricsWindow.setBounds(next, false)
  setTimeout(() => {
    lyricsProgrammaticMove = false
  }, 120)
}

function rememberLyricsBounds(): void {
  if (!lyricsWindow || lyricsWindow.isDestroyed() || lyricsProgrammaticMove) return
  lyricsUserBounds = lyricsWindow.getBounds()
}

function applyLyricsMouseBehavior(): void {
  if (!lyricsWindow || lyricsWindow.isDestroyed()) return
  const locked = lyricsState.clickThrough !== false
  const shouldIgnore = locked || !lyricsPointerCapture
  if (lyricsMouseIgnored === shouldIgnore) return
  lyricsMouseIgnored = shouldIgnore
  lyricsWindow.setIgnoreMouseEvents(shouldIgnore, { forward: true })
}

function lyricsHotBoundsOnScreen(): Electron.Rectangle | null {
  if (!lyricsWindow || lyricsWindow.isDestroyed()) return null
  const wb = lyricsWindow.getBounds()
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

function broadcastLyricsEnabledState(enabled: boolean): void {
  const main = getMainWindow()
  if (main && !main.isDestroyed()) main.webContents.send('lyrics:enabled-state-changed', { enabled })
}

function sendLyricsState(): void {
  if (!lyricsWindow || lyricsWindow.isDestroyed()) return
  lyricsWindow.webContents.send('overlay:lyrics-state', lyricsState)
}

export function positionDesktopLyricsWindow(payload: LyricsPayload = lyricsState, force = false): void {
  if (!lyricsWindow || lyricsWindow.isDestroyed()) return
  const useManual = lyricsUserBounds && !force
  setLyricsBounds(useManual && lyricsUserBounds ? lyricsUserBounds : lyricsDefaultBounds(payload))
  lyricsWindow.setOpacity(clampNumber(payload.opacity, 0.28, 1, 0.92))
}

function createLyricsWindow(payload: LyricsPayload): BrowserWindow {
  const prevY = lyricsState.y
  const prevOpacity = lyricsState.opacity
  lyricsState = { ...lyricsState, ...payload, enabled: true }
  const hasY = Object.prototype.hasOwnProperty.call(payload, 'y')
  const nextY = clampNumber(lyricsState.y, 0.08, 0.92, 0.76)
  const yChanged = hasY && Number.isFinite(Number(prevY)) && Math.abs(nextY - clampNumber(prevY, 0.08, 0.92, 0.76)) > 0.001
  const opacityChanged =
    Object.prototype.hasOwnProperty.call(payload, 'opacity') &&
    Math.abs(clampNumber(lyricsState.opacity, 0.28, 1, 0.92) - clampNumber(prevOpacity, 0.28, 1, 0.92)) > 0.001
  if (yChanged) lyricsUserBounds = null

  if (lyricsWindow && !lyricsWindow.isDestroyed()) {
    if (yChanged) positionDesktopLyricsWindow(lyricsState, true)
    else if (opacityChanged) lyricsWindow.setOpacity(clampNumber(lyricsState.opacity, 0.28, 1, 0.92))
    applyLyricsMouseBehavior()
    sendLyricsState()
    return lyricsWindow
  }

  lyricsWindow = new BrowserWindow({
    width: 920,
    height: 190,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: true,
    focusable: false,
    skipTaskbar: true,
    show: false,
    title: 'Simple Music Desktop Lyrics',
    webPreferences: { preload: overlayPreload(), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false }
  })
  hardenOverlayWindow(lyricsWindow)
  try {
    lyricsWindow.setAlwaysOnTop(true, 'screen-saver')
    lyricsWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  } catch (e) {
    console.warn('Desktop lyrics topmost setup skipped:', (e as Error).message)
  }
  platform.startMousePoller(handleMiddleClick)
  applyLyricsMouseBehavior()
  positionDesktopLyricsWindow(lyricsState, yChanged || !lyricsUserBounds)
  lyricsWindow.once('ready-to-show', () => {
    if (!lyricsWindow || lyricsWindow.isDestroyed()) return
    lyricsWindow.showInactive()
    sendLyricsState()
  })
  lyricsWindow.webContents.once('did-finish-load', sendLyricsState)
  lyricsWindow.on('closed', () => {
    lyricsWindow = null
    lyricsMouseIgnored = null
  })
  lyricsWindow.on('moved', rememberLyricsBounds)
  lyricsWindow.loadURL(resolveRendererUrl('overlays/desktop-lyrics/desktop-lyrics.html')).catch((e) =>
    console.warn('Desktop lyrics load failed:', (e as Error).message)
  )
  return lyricsWindow
}

function closeLyricsWindow(): void {
  lyricsState = { ...lyricsState, enabled: false }
  lyricsPointerCapture = false
  lyricsMouseIgnored = null
  lyricsHotBounds = null
  platform.stopMousePoller()
  if (lyricsWindow && !lyricsWindow.isDestroyed()) {
    sendLyricsState()
    lyricsWindow.close()
  }
  lyricsWindow = null
  broadcastLyricsEnabledState(false)
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
  const needUnlock = next.width !== cur.width || next.height !== cur.height
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
  miniPlayerUserBounds = b
  if (b.width !== miniPlayerWidth) {
    miniPlayerWidth = b.width
    notifyMiniPlayerWidth(b.width)
  }
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
    focusable: false,
    skipTaskbar: true,
    show: false,
    title: 'Simple Music Mini Player',
    webPreferences: { preload: overlayPreload(), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false }
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
    if (win.isDestroyed()) return
    win.showInactive()
    sendMiniPlayerState()
  })
  win.webContents.once('did-finish-load', sendMiniPlayerState)
  win.on('closed', () => {
    if (miniPlayerWindow === win) miniPlayerWindow = null
  })
  win.on('moved', rememberMiniPlayerBounds)
  win.loadURL(resolveRendererUrl('overlays/mini-player/mini-player.html')).catch((e) =>
    console.warn('Mini player load failed:', (e as Error).message)
  )
  return win
}

function closeMiniPlayerWindow(): void {
  if (miniPlayerWindow && !miniPlayerWindow.isDestroyed()) miniPlayerWindow.close()
  miniPlayerWindow = null
  miniPlayerPopoverOpen = false
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

/** 迷你条 X：收起迷你条并退居托盘，主窗口保持隐藏（后台继续播放，经托盘恢复）。 */
export function hideMiniPlayerToTray(): OkResult {
  closeMiniPlayerWindow()
  notifyRendererMiniOff()
  return { ok: true }
}

export function updateMiniPlayer(payload: MiniPlayerPayload): OkResult {
  miniPlayerState = { ...miniPlayerState, ...payload }
  sendMiniPlayerState()
  return { ok: true }
}

export function moveMiniPlayerBy(dx: number, dy: number): OkResult {
  if (!miniPlayerWindow || miniPlayerWindow.isDestroyed()) return { ok: false, error: 'NO_MINI_PLAYER_WINDOW' }
  const b = miniPlayerWindow.getBounds()
  setMiniPlayerBounds({ ...b, x: b.x + Math.round(clampNumber(dx, -200, 200, 0)), y: b.y + Math.round(clampNumber(dy, -200, 200, 0)) })
  return { ok: true }
}

/** 右边缘手柄拖拽：只改宽度，左上角不动。 */
export function resizeMiniPlayerBy(dx: number): OkResult {
  if (!miniPlayerWindow || miniPlayerWindow.isDestroyed()) return { ok: false, error: 'NO_MINI_PLAYER_WINDOW' }
  const b = miniPlayerWindow.getBounds()
  const before = b.width
  setMiniPlayerBounds({ ...b, width: b.width + Math.round(clampNumber(dx, -400, 400, 0)) })
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
export function setLyricsEnabled(enabled: boolean, payload: LyricsPayload = {}): OkResult {
  if (enabled) {
    createLyricsWindow(payload)
    broadcastLyricsEnabledState(true)
  } else {
    closeLyricsWindow()
  }
  return { ok: true }
}

export function updateLyrics(payload: LyricsPayload = {}): OkResult {
  const next = { ...lyricsState, ...payload }
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
  const b = lyricsWindow.getBounds()
  lyricsWindow.setBounds(
    { ...b, x: Math.round(b.x + clampNumber(dx, -160, 160, 0)), y: Math.round(b.y + clampNumber(dy, -160, 160, 0)) },
    false
  )
  lyricsUserBounds = lyricsWindow.getBounds()
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
  closeLyricsWindow()
  closeWallpaperWindow()
  closeMiniPlayerWindow()
}
