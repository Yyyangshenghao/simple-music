import { contextBridge, ipcRenderer } from 'electron'
import type { LyricsPayload, WallpaperPayload, HotBounds } from '../../src/types/ipc'

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
  closeLyrics: () => ipcRenderer.invoke('overlay:lyrics-close')
}

contextBridge.exposeInMainWorld('desktopOverlay', api)
export type DesktopOverlayApi = typeof api
