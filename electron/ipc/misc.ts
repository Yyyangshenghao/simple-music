import { ipcMain, dialog, shell, app } from 'electron'
import { writeFileSync, readFileSync, existsSync, promises as fs } from 'node:fs'
import { resolve, sep, isAbsolute } from 'node:path'
import { getMainWindow, setShortcutRecording } from '../modules/window-manager'
import { configureHotkeys } from '../modules/hotkey-manager'
import { configureSettingsMenu } from '../modules/settings-menu'
import { installUpdateMac, installUpdateWindows } from '../modules/update-installer'
import { listSystemFonts } from '../modules/font-manager'
import { updateWorkDir } from '../../server/lib/update-download-dir'
import type {
  HotkeyConfiguration,
  ExportPayload,
  FileResult,
  ImportResult,
  OkResult,
  SystemFontResult
} from '../../src/types/ipc'

function getUpdateDownloadDir(): string {
  return process.env.SIMPLEMUSIC_UPDATE_DOWNLOAD_DIR || updateWorkDir(app.getPath('userData'))
}

export function registerMiscIpc(): void {
  ipcMain.handle('hotkeys:configure', (_e, config: HotkeyConfiguration) => {
    if (typeof config?.settingsAccelerator === 'string') configureSettingsMenu(config.settingsAccelerator)
    setShortcutRecording(!!config?.recording)
    return configureHotkeys(config?.bindings ?? [])
  })

  ipcMain.handle('system:list-fonts', async (): Promise<SystemFontResult> => {
    try {
      return { ok: true, fonts: await listSystemFonts() }
    } catch (e) {
      return { ok: false, fonts: [], error: (e as Error).message || 'LIST_FONTS_FAILED' }
    }
  })

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

  ipcMain.handle('file:select-directory', async (_e, arg: { title?: string; defaultPath?: string } = {}): Promise<FileResult> => {
    try {
      const owner = getMainWindow() ?? undefined
      const result = await dialog.showOpenDialog(owner!, {
        title: arg?.title || '选择文件夹',
        defaultPath: arg?.defaultPath || undefined,
        properties: ['openDirectory', 'createDirectory']
      })
      if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true }
      return { ok: true, filePath: result.filePaths[0] }
    } catch (e) {
      return { ok: false, error: (e as Error).message || 'SELECT_DIRECTORY_FAILED' }
    }
  })

  ipcMain.handle('file:open-directory', async (_e, arg: { path?: unknown }): Promise<OkResult> => {
    try {
      if (typeof arg?.path !== 'string' || !isAbsolute(arg.path) || !(await fs.stat(arg.path)).isDirectory()) {
        return { ok: false, error: 'INVALID_DIRECTORY' }
      }
      const error = await shell.openPath(arg.path)
      return error ? { ok: false, error } : { ok: true }
    } catch {
      return { ok: false, error: 'OPEN_DIRECTORY_FAILED' }
    }
  })

  ipcMain.handle('app:restart', async (): Promise<OkResult> => {
    try {
      app.relaunch()
      app.quit()
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message || 'RESTART_FAILED' }
    }
  })

  ipcMain.handle('app:install-update', async (_e, arg: { filePath: string }): Promise<OkResult> => {
    try {
      const target = resolve(String(arg?.filePath ?? ''))
      const updateDir = resolve(getUpdateDownloadDir())
      const updatePrefix = updateDir.endsWith(sep) ? updateDir : updateDir + sep
      if (!target || target === updateDir || !target.startsWith(updatePrefix)) return { ok: false, error: 'INVALID_UPDATE_PATH' }
      if (!existsSync(target)) return { ok: false, error: 'UPDATE_FILE_MISSING' }

      if (process.platform === 'win32') {
        const result = await installUpdateWindows(target)
        if (!result.ok) return result
        app.quit()
        return { ok: true }
      }
      if (process.platform === 'darwin') {
        const result = await installUpdateMac(target)
        if (!result.ok) return result
        app.quit()
        return { ok: true }
      }
      // 其它平台没有对应的打包产物，保留旧行为兜底
      const error = await shell.openPath(target)
      return error ? { ok: false, error } : { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message || 'INSTALL_UPDATE_FAILED' }
    }
  })
}
