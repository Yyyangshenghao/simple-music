import { contextBridge, ipcRenderer } from 'electron'
import type { LyricsPayload, WallpaperPayload, MiniPlayerPayload, HotBounds } from '../../src/types/ipc'

function on<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: Electron.IpcRendererEvent, payload: T) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api = {
  onLyricsState: (cb: (p: LyricsPayload) => void) => on<LyricsPayload>('overlay:lyrics-state', cb),
  onWallpaperState: (cb: (p: WallpaperPayload) => void) => on<WallpaperPayload>('overlay:wallpaper-state', cb),
  setLyricsDrag: (dragging: boolean) => ipcRenderer.invoke('overlay:lyrics-set-dragging', { dragging }),
  setLyricsPointerCapture: (active: boolean) => ipcRenderer.invoke('overlay:lyrics-set-pointer-capture', { active }),
  setLyricsHotBounds: (bounds: HotBounds) => ipcRenderer.invoke('overlay:lyrics-set-hot-bounds', bounds),
  setLyricsLockState: (locked: boolean) => ipcRenderer.invoke('overlay:lyrics-set-lock', { locked }),
  moveLyricsBy: (dx: number, dy: number) => ipcRenderer.invoke('overlay:lyrics-move-by', { dx, dy }),
  closeLyrics: () => ipcRenderer.invoke('overlay:lyrics-close'),

  onMiniPlayerState: (cb: (p: MiniPlayerPayload) => void) => on<MiniPlayerPayload>('overlay:miniplayer-state', cb),
  moveMiniPlayerBy: (dx: number, dy: number) => ipcRenderer.invoke('overlay:miniplayer-move-by', { dx, dy }),
  resizeMiniPlayerBy: (dx: number) => ipcRenderer.invoke('overlay:miniplayer-resize-by', { dx }),
  setMiniPlayerPopover: (open: boolean) => ipcRenderer.invoke('overlay:miniplayer-set-popover', { open }),
  miniPlayerControl: (action: string, value?: number) => ipcRenderer.invoke('overlay:miniplayer-control', { action, value }),
  closeMiniPlayer: () => ipcRenderer.invoke('overlay:miniplayer-close'),
  focusMainFromMiniPlayer: () => ipcRenderer.invoke('overlay:miniplayer-focus-main')
}

contextBridge.exposeInMainWorld('desktopOverlay', api)
export type DesktopOverlayApi = typeof api
