import { ipcMain, dialog, shell, app } from 'electron'
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { resolve, sep, join } from 'node:path'
import { getMainWindow } from '../modules/window-manager'
import { configureHotkeys } from '../modules/hotkey-manager'
import type {
  HotkeyBinding,
  ExportPayload,
  FileResult,
  ImportResult,
  OkResult
} from '../../src/types/ipc'

function getUpdateDownloadDir(): string {
  return join(app.getPath('userData'), 'updates')
}

export function registerMiscIpc(): void {
  ipcMain.handle('hotkeys:configure', (_e, bindings: HotkeyBinding[]) => configureHotkeys(bindings ?? []))

  ipcMain.handle('file:export-json', async (_e, payload: ExportPayload = {}): Promise<FileResult> => {
    try {
      const owner = getMainWindow() ?? undefined
      const defaultName = String(payload.defaultName ?? 'simplemusic-export.json').replace(/[\\/:*?"<>|]+/g, '-')
      const result = await dialog.showSaveDialog(owner!, {
        title: '导出 Simple Music 存档',
        defaultPath: defaultName.toLowerCase().endsWith('.json') ? defaultName : `${defaultName}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })
      if (result.canceled || !result.filePath) return { ok: false, canceled: true }
      const text = typeof payload.text === 'string' ? payload.text : JSON.stringify(payload.data ?? {}, null, 2)
      writeFileSync(result.filePath, text, 'utf8')
      return { ok: true, filePath: result.filePath }
    } catch (e) {
      return { ok: false, error: (e as Error).message || 'EXPORT_FAILED' }
    }
  })

  ipcMain.handle('file:import-json', async (): Promise<ImportResult> => {
    try {
      const owner = getMainWindow() ?? undefined
      const result = await dialog.showOpenDialog(owner!, {
        title: '导入 Simple Music 存档',
        properties: ['openFile'],
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })
      if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true }
      const filePath = result.filePaths[0]
      return { ok: true, filePath, text: readFileSync(filePath, 'utf8') }
    } catch (e) {
      return { ok: false, error: (e as Error).message || 'IMPORT_FAILED' }
    }
  })

  ipcMain.handle('app:restart', async (): Promise<OkResult> => {
    try {
      app.relaunch()
      app.exit(0)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message || 'RESTART_FAILED' }
    }
  })

  ipcMain.handle('app:open-update', async (_e, arg: { filePath: string }): Promise<OkResult> => {
    try {
      const target = resolve(String(arg?.filePath ?? ''))
      const updateDir = resolve(getUpdateDownloadDir())
      if (!target || !target.startsWith(updateDir + sep)) return { ok: false, error: 'INVALID_UPDATE_PATH' }
      if (!existsSync(target)) return { ok: false, error: 'UPDATE_FILE_MISSING' }
      const error = await shell.openPath(target)
      return error ? { ok: false, error } : { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message || 'OPEN_UPDATE_FAILED' }
    }
  })
}
