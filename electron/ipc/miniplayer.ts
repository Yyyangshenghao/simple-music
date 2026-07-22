import { ipcMain } from 'electron'
import {
  setMiniPlayerEnabled,
  updateMiniPlayer,
  moveMiniPlayerBy,
  resizeMiniPlayerBy,
  setMiniPlayerPopover,
  triggerMiniPlayerControl,
  returnFromMiniPlayer,
  hideMiniPlayerToTray
} from '../modules/overlay-manager'
import type { MiniPlayerPayload } from '../../src/types/ipc'

export function registerMiniPlayerIpc(): void {
  // 主契约通道
  ipcMain.handle('miniplayer:set-enabled', (_e, arg: { enabled: boolean; width?: number }) =>
    setMiniPlayerEnabled(!!arg?.enabled, typeof arg?.width === 'number' ? arg.width : undefined)
  )
  ipcMain.handle('miniplayer:update', (_e, payload: MiniPlayerPayload) => updateMiniPlayer(payload ?? {}))

  // overlay 内部通道
  ipcMain.handle('overlay:miniplayer-move-by', (_e, arg: { dx: number; dy: number }) =>
    moveMiniPlayerBy(Number(arg?.dx) || 0, Number(arg?.dy) || 0)
  )
  ipcMain.handle('overlay:miniplayer-resize-by', (_e, arg: { dx: number }) => resizeMiniPlayerBy(Number(arg?.dx) || 0))
  ipcMain.handle('overlay:miniplayer-set-popover', (_e, arg: { open: boolean }) => setMiniPlayerPopover(!!arg?.open))
  ipcMain.handle('overlay:miniplayer-control', (_e, arg: { action: string; value?: number }) =>
    triggerMiniPlayerControl(String(arg?.action ?? ''), typeof arg?.value === 'number' ? arg.value : undefined)
  )
  // X:收起迷你条并退居托盘,主窗口保持隐藏(设置开关经 sync-off 回落)
  ipcMain.handle('overlay:miniplayer-close', () => hideMiniPlayerToTray())
  // 封面/回到大播放器:恢复主窗口 + 关闭迷你条 + 同步设置开关
  ipcMain.handle('overlay:miniplayer-focus-main', () => returnFromMiniPlayer())
}
