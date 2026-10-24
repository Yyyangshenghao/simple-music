import { app, dialog, ipcMain } from 'electron'
import { getMainWindow } from '../modules/window-manager'
import {
  CUSTOM_BACKGROUND_EXTENSIONS,
  CustomBackgroundError,
  importCustomBackground,
  removeCustomBackground
} from '../../server/lib/custom-background'
import type { BackgroundImportResult, OkResult } from '../../src/types/ipc'

/** 自定义背景：路径只在主进程内经系统对话框取得，渲染层拿到的是复制后的 id。 */
export function registerBackgroundIpc(): void {
  ipcMain.handle('background:import', async (): Promise<BackgroundImportResult> => {
    try {
      const owner = getMainWindow() ?? undefined
      const result = await dialog.showOpenDialog(owner!, {
        title: '选择背景图片、视频或 Wallpaper Engine 工程',
        properties: ['openFile'],
        filters: [
          { name: '图片、视频或 Wallpaper Engine', extensions: [...CUSTOM_BACKGROUND_EXTENSIONS, 'json'] },
          { name: 'Wallpaper Engine 工程 (project.json)', extensions: ['json'] }
        ]
      })
      if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true }
      return { ok: true, media: await importCustomBackground(app.getPath('userData'), result.filePaths[0]) }
    } catch (e) {
      return { ok: false, error: e instanceof CustomBackgroundError ? e.message : 'IMPORT_FAILED' }
    }
  })

  ipcMain.handle('background:remove', async (_e, arg: { id?: unknown }): Promise<OkResult> => {
    if (typeof arg?.id !== 'string') return { ok: false, error: 'INVALID_ID' }
    try {
      await removeCustomBackground(app.getPath('userData'), arg.id)
      return { ok: true }
    } catch {
      return { ok: false, error: 'REMOVE_FAILED' }
    }
  })
}
