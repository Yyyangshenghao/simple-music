import { contextBridge, ipcRenderer } from 'electron'
import type { LyricsPayload, WallpaperPayload, MiniPlayerPayload, HotBounds } from '../../src/types/ipc'

function on<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: Electron.IpcRendererEvent, payload: T) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

// preload 早于页面脚本执行：先接住首屏快照，避免 React effect 尚未订阅时丢状态。
let lyricsState: LyricsPayload = {}
const lyricsListeners = new Set<(payload: LyricsPayload) => void>()
ipcRenderer.on('overlay:lyrics-state', (_event, payload: LyricsPayload) => {
  lyricsState = { ...lyricsState, ...payload }
  for (const listener of lyricsListeners) listener(lyricsState)
})

let miniPlayerState: MiniPlayerPayload = {}
const miniPlayerListeners = new Set<(payload: MiniPlayerPayload) => void>()
ipcRenderer.on('overlay:miniplayer-state', (_event, payload: MiniPlayerPayload) => {
  miniPlayerState = { ...miniPlayerState, ...payload }
  for (const listener of miniPlayerListeners) listener(payload)
})

const api = {
  platform: process.platform,
  onLyricsState: (cb: (p: LyricsPayload) => void): (() => void) => {
    lyricsListeners.add(cb)
    if (Object.keys(lyricsState).length) cb(lyricsState)
    return () => { lyricsListeners.delete(cb) }
  },
  onWallpaperState: (cb: (p: WallpaperPayload) => void) => on<WallpaperPayload>('overlay:wallpaper-state', cb),
  setLyricsDrag: (dragging: boolean) => ipcRenderer.invoke('overlay:lyrics-set-dragging', { dragging }),
  setLyricsPointerCapture: (active: boolean) => ipcRenderer.invoke('overlay:lyrics-set-pointer-capture', { active }),
  setLyricsHotBounds: (bounds: HotBounds) => ipcRenderer.invoke('overlay:lyrics-set-hot-bounds', bounds),
  setLyricsControlBounds: (bounds: HotBounds & { hover?: HotBounds; contentWidth?: number }) => ipcRenderer.invoke('overlay:lyrics-set-control-bounds', bounds),
  setLyricsLockState: (locked: boolean) => ipcRenderer.invoke('overlay:lyrics-set-lock', { locked }),
  moveLyricsBy: (dx: number, dy: number) => ipcRenderer.invoke('overlay:lyrics-move-by', { dx, dy }),
  resizeLyrics: (width: number, height: number, anchor?: 'top-left') => ipcRenderer.invoke('overlay:lyrics-resize', { width, height, ...(anchor ? { anchor } : {}) }),
  closeLyrics: () => ipcRenderer.invoke('overlay:lyrics-close'),

  onMiniPlayerState: (cb: (p: MiniPlayerPayload) => void): (() => void) => {
    miniPlayerListeners.add(cb)
    if (Object.keys(miniPlayerState).length) cb(miniPlayerState)
    return () => { miniPlayerListeners.delete(cb) }
  },
  moveMiniPlayerBy: (dx: number, dy: number) => ipcRenderer.invoke('overlay:miniplayer-move-by', { dx, dy }),
  resizeMiniPlayerBy: (dx: number) => ipcRenderer.invoke('overlay:miniplayer-resize-by', { dx }),
  setMiniPlayerPopover: (open: boolean) => ipcRenderer.invoke('overlay:miniplayer-set-popover', { open }),
  miniPlayerControl: (action: string, value?: number) => ipcRenderer.invoke('overlay:miniplayer-control', { action, value }),
  closeMiniPlayer: () => ipcRenderer.invoke('overlay:miniplayer-close'),
  focusMainFromMiniPlayer: () => ipcRenderer.invoke('overlay:miniplayer-focus-main')
}

contextBridge.exposeInMainWorld('desktopOverlay', api)
export type DesktopOverlayApi = typeof api
