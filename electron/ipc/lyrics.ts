import { ipcMain } from 'electron'
import {
  setLyricsEnabled,
  updateLyrics,
  setLyricsLock,
  moveLyricsBy,
  resizeLyrics,
  setLyricsPointerCapture,
  setLyricsControlBounds,
  setLyricsHotBounds
} from '../modules/overlay-manager'
import type { LyricsPayload, HotBounds } from '../../src/types/ipc'

export function registerLyricsIpc(): void {
  // 主契约通道
  ipcMain.handle('lyrics:set-enabled', (_e, arg: { enabled: boolean; payload?: LyricsPayload }) =>
    setLyricsEnabled(!!arg?.enabled, arg?.payload ?? {}, true)
  )
  ipcMain.handle('lyrics:update', (_e, payload: LyricsPayload) => updateLyrics(payload ?? {}))
  ipcMain.handle('lyrics:set-lock', (_e, arg: { locked: boolean }) => setLyricsLock(!!arg?.locked))
  ipcMain.handle('lyrics:move-by', (_e, arg: { dx: number; dy: number }) =>
    moveLyricsBy(Number(arg?.dx) || 0, Number(arg?.dy) || 0)
  )

  // overlay 内部通道
  ipcMain.handle('overlay:lyrics-set-dragging', () => ({ ok: true }))
  ipcMain.handle('overlay:lyrics-set-pointer-capture', (_e, arg: { active: boolean }) =>
    setLyricsPointerCapture(!!arg?.active)
  )
  ipcMain.handle('overlay:lyrics-set-hot-bounds', (_e, bounds: Partial<HotBounds>) =>
    setLyricsHotBounds(bounds ?? {})
  )
  ipcMain.handle('overlay:lyrics-set-control-bounds', (_e, bounds: Partial<HotBounds> & { hover?: HotBounds }) =>
    setLyricsControlBounds(bounds ?? {})
  )
  ipcMain.handle('overlay:lyrics-set-lock', (_e, arg: { locked: boolean }) => setLyricsLock(!!arg?.locked))
  ipcMain.handle('overlay:lyrics-move-by', (_e, arg: { dx: number; dy: number }) =>
    moveLyricsBy(Number(arg?.dx) || 0, Number(arg?.dy) || 0)
  )
  ipcMain.handle('overlay:lyrics-close', () => setLyricsEnabled(false))
  ipcMain.handle('overlay:lyrics-resize', (_e, arg: { width: number; height: number; anchor?: 'top-left' }) =>
    resizeLyrics(Number(arg?.width), Number(arg?.height), arg?.anchor === 'top-left' ? 'top-left' : undefined)
  )
}
