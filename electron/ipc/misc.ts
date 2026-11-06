import { ipcMain, dialog, shell, app } from 'electron'
import { writeFileSync, readFileSync, existsSync, promises as fs } from 'node:fs'
import { resolve, sep, isAbsolute } from 'node:path'
import { getMainWindow, setShortcutRecording } from '../modules/window-manager'
import { configureHotkeys } from '../modules/hotkey-manager'
import { configureSettingsMenu } from '../modules/settings-menu'
import { installUpdateMac, installUpdateWindows, takeLastMacInstall } from '../modules/update-installer'
import { listSystemFontsCached } from '../modules/font-manager'
import { findLocalTrack } from '../../server/lib/local-library'
import { updateWorkDir } from '../../server/lib/update-download-dir'
import { updateDownloadJobs, verifyUpdateFile } from '../../server/lib/update'
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
  let windowsInstallPending = false
  ipcMain.handle('hotkeys:configure', (_e, config: HotkeyConfiguration) => {
    if (typeof config?.settingsAccelerator === 'string') configureSettingsMenu(config.settingsAccelerator)
    setShortcutRecording(!!config?.recording)
    return configureHotkeys(config?.bindings ?? [])
  })

  ipcMain.handle('system:list-fonts', async (): Promise<SystemFontResult> => {
    try {
      return { ok: true, fonts: await listSystemFontsCached() }
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

  ipcMain.handle('file:reveal-local-track', async (_e, arg: { id?: unknown }): Promise<OkResult> => {
    if (typeof arg?.id !== 'string' || !arg.id.trim()) return { ok: false, error: 'INVALID_LOCAL_TRACK_ID' }
    try {
      const track = await findLocalTrack(app.getPath('userData'), arg.id)
      if (!track) return { ok: false, error: 'LOCAL_TRACK_NOT_FOUND' }
      if (!(await fs.stat(track.path)).isFile()) return { ok: false, error: 'LOCAL_TRACK_FILE_MISSING' }
      shell.showItemInFolder(track.path)
      return { ok: true }
    } catch {
      return { ok: false, error: 'REVEAL_LOCAL_TRACK_FAILED' }
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

  ipcMain.handle('app:last-update-install', () => takeLastMacInstall())

  ipcMain.handle('app:install-update', async (_e, arg: { filePath: string; version?: string }): Promise<OkResult> => {
    try {
      const target = resolve(String(arg?.filePath ?? ''))
      const updateDir = resolve(getUpdateDownloadDir())
      const updatePrefix = updateDir.endsWith(sep) ? updateDir : updateDir + sep
      if (!target || target === updateDir || !target.startsWith(updatePrefix)) return { ok: false, error: 'INVALID_UPDATE_PATH' }
      if (!existsSync(target)) return { ok: false, error: 'UPDATE_FILE_MISSING' }

      if (process.platform === 'win32') {
        if (process.env.PORTABLE_EXECUTABLE_DIR || process.env.PORTABLE_EXECUTABLE_FILE) {
          return { ok: false, error: 'PORTABLE_UPDATE_UNSUPPORTED' }
        }
        if (windowsInstallPending) return { ok: false, error: 'UPDATE_INSTALL_IN_PROGRESS' }
        windowsInstallPending = true
        let started = false
        try {
          const job = Array.from(updateDownloadJobs.values()).find(job =>
            job.mode === 'installer' && job.status === 'ready' && resolve(job.filePath) === target
          )
          if (!job) return { ok: false, error: 'UPDATE_NOT_READY' }
          if (typeof arg?.version === 'string' && arg.version !== job.version) {
            return { ok: false, error: 'UPDATE_VERSION_MISMATCH' }
          }
          // 前缀检查不能识别目录联接/符号链接；执行前核对实际落点、文件类型和下载时的摘要。
          const [realTarget, realUpdateDir] = await Promise.all([fs.realpath(target), fs.realpath(updateDir)])
          const realPrefix = realUpdateDir.endsWith(sep) ? realUpdateDir : realUpdateDir + sep
          if (!realTarget.toLowerCase().startsWith(realPrefix.toLowerCase())) return { ok: false, error: 'INVALID_UPDATE_PATH' }
          if (!(await fs.stat(realTarget)).isFile()) return { ok: false, error: 'INVALID_UPDATE_FILE' }
          await verifyUpdateFile(realTarget, job)
          const result = await installUpdateWindows(realTarget)
          if (!result.ok) return result
          started = true
          app.quit()
          return { ok: true }
        } finally {
          // 成功启动后保持门闩，直到正常退出；失败允许重试。
          if (!started) windowsInstallPending = false
        }
      }
      if (process.platform === 'darwin') {
        // 原地替换（swap）由脱离的脚本等本进程退出后完成；回退成打开 dmg 时同样退出，让用户直接拖入替换。
        const result = await installUpdateMac(target, typeof arg?.version === 'string' ? arg.version : undefined)
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
