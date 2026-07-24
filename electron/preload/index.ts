import { contextBridge, ipcRenderer } from 'electron'
import type {
  WindowState,
  LoginResult,
  OkResult,
  LyricsPayload,
  WallpaperPayload,
  MiniPlayerPayload,
  HotkeyBinding,
  HotkeyResult,
  ExportPayload,
  FileResult,
  ImportResult
} from '../../src/types/ipc'

function readServerPort(): number {
  const arg = process.argv.find((a) => a.startsWith('--simplemusic-server-port='))
  return arg ? Number(arg.split('=')[1]) || 0 : 0
}

function readServerToken(): string {
  const arg = process.argv.find((a) => a.startsWith('--simplemusic-server-token='))
  return arg ? arg.slice('--simplemusic-server-token='.length) : ''
}

function on<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: Electron.IpcRendererEvent, payload: T) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api = {
  isDesktop: true,
  platform: process.platform,
  serverPort: readServerPort(),
  serverToken: readServerToken(),

  // 窗口
  minimize: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
  toggleFullscreen: (): Promise<void> => ipcRenderer.invoke('window:toggle-fullscreen'),
  exitFullscreenWindowed: (): Promise<void> => ipcRenderer.invoke('window:exit-fullscreen-windowed'),
  getState: (): Promise<WindowState> => ipcRenderer.invoke('window:get-state'),
  close: (): Promise<void> => ipcRenderer.invoke('window:close'),
  maximize: (): Promise<void> => ipcRenderer.invoke('window:maximize'),
  onStateChange: (cb: (s: WindowState) => void) => on<WindowState>('window:state-changed', cb),

  // 登录
  openNeteaseLogin: (): Promise<LoginResult> => ipcRenderer.invoke('login:netease-open'),
  clearNeteaseLogin: (): Promise<OkResult> => ipcRenderer.invoke('login:netease-clear'),
  openQQLogin: (): Promise<LoginResult> => ipcRenderer.invoke('login:qq-open'),
  clearQQLogin: (): Promise<OkResult> => ipcRenderer.invoke('login:qq-clear'),

  // 桌面歌词
  setDesktopLyricsEnabled: (enabled: boolean, payload?: LyricsPayload): Promise<OkResult> =>
    ipcRenderer.invoke('lyrics:set-enabled', { enabled, payload }),
  updateDesktopLyrics: (payload: LyricsPayload): Promise<OkResult> => ipcRenderer.invoke('lyrics:update', payload),
  setDesktopLyricsLock: (locked: boolean): Promise<OkResult> => ipcRenderer.invoke('lyrics:set-lock', { locked }),
  moveDesktopLyricsBy: (dx: number, dy: number): Promise<OkResult> => ipcRenderer.invoke('lyrics:move-by', { dx, dy }),
  onDesktopLyricsLockState: (cb: (p: { locked: boolean }) => void) => on('lyrics:lock-state-changed', cb),
  onDesktopLyricsEnabledState: (cb: (p: { enabled: boolean }) => void) => on('lyrics:enabled-state-changed', cb),

  // 壁纸
  setWallpaperEnabled: (enabled: boolean, payload?: WallpaperPayload): Promise<OkResult> =>
    ipcRenderer.invoke('wallpaper:set-enabled', { enabled, payload }),
  updateWallpaper: (payload: WallpaperPayload): Promise<OkResult> => ipcRenderer.invoke('wallpaper:update', payload),

  // 迷你播放条
  setMiniPlayerEnabled: (enabled: boolean, width?: number): Promise<OkResult> =>
    ipcRenderer.invoke('miniplayer:set-enabled', { enabled, width }),
  updateMiniPlayer: (payload: MiniPlayerPayload): Promise<OkResult> => ipcRenderer.invoke('miniplayer:update', payload),
  onMiniPlayerControl: (cb: (p: { action: string; value?: number }) => void) => on('miniplayer:control', cb),
  onMiniPlayerWidthChanged: (cb: (p: { width: number }) => void) => on('miniplayer:width-changed', cb),

  // 快捷键
  configureHotkeys: (bindings: HotkeyBinding[]): Promise<HotkeyResult> =>
    ipcRenderer.invoke('hotkeys:configure', bindings ?? []),
  onHotkey: (cb: (p: { action: string }) => void) => on('hotkey:triggered', cb),

  // 文件 / 应用
  exportJson: (payload: ExportPayload): Promise<FileResult> => ipcRenderer.invoke('file:export-json', payload),
  importJson: (): Promise<ImportResult> => ipcRenderer.invoke('file:import-json'),
  selectDirectory: (arg?: { title?: string; defaultPath?: string }): Promise<FileResult> =>
    ipcRenderer.invoke('file:select-directory', arg ?? {}),
  restartApp: (): Promise<OkResult> => ipcRenderer.invoke('app:restart'),
  installUpdate: (filePath: string): Promise<OkResult> => ipcRenderer.invoke('app:install-update', { filePath })
}

contextBridge.exposeInMainWorld('desktop', api)
export type DesktopApi = typeof api

window.addEventListener('DOMContentLoaded', () => {
  document.documentElement.classList.add('desktop-shell-root')
  document.body.classList.add('desktop-shell')
})
