import { app, BrowserWindow, ipcMain, session } from 'electron'
import { join } from 'node:path'
import { constants, setPriority } from 'node:os'
import { resolveRendererUrl } from './modules/window-manager'
import { KARAOKE_HELPER_DATA_ARG, KARAOKE_HELPER_FLAG } from './modules/karaoke-helper'
import { createNativeInference } from './modules/karaoke-native'
import { isKaraokeModelId } from '../src/types/karaoke'

interface HelperInit {
  type: 'init'
  port: number
  token: string
  userDataDir: string
}

export function isKaraokeHelperProcess(): boolean {
  return process.argv.includes(KARAOKE_HELPER_FLAG)
}

const isInit = (value: unknown): value is HelperInit => {
  const init = value as Partial<HelperInit> | null
  return !!init && init.type === 'init' && Number.isInteger(init.port) && typeof init.token === 'string' && typeof init.userDataDir === 'string'
}

/**
 * 分离进程入口：不申请单实例锁、不出现在 Dock，只开一个隐藏页面跑 WebGPU 推理。
 * 与主进程之间是 Node IPC 通道，主进程退出或断开时随之退出。
 */
export function runKaraokeHelper(): void {
  if (process.platform === 'darwin') app.setActivationPolicy('accessory')
  // 与主实例分开存放配置，避免两个进程同时写同一个 Chromium 配置目录；必须在 ready 之前设置
  const dataArg = process.argv.find(arg => arg.startsWith(KARAOKE_HELPER_DATA_ARG))
  if (!dataArg) {
    app.exit(1)
    return
  }
  app.setPath('userData', dataArg.slice(KARAOKE_HELPER_DATA_ARG.length))
  // 后台计算让出 CPU 调度优先级；仅影响分离实例及其后续子进程。
  try { setPriority(0, constants.priority.PRIORITY_BELOW_NORMAL) } catch (error) {
    console.warn('[Karaoke] 无法降低分离进程优先级', error)
  }
  // 已按实例降低优先级，避免 Chromium 对无声隐藏页再额外降级；计算节奏由 Worker 的块间空档控制。
  app.commandLine.appendSwitch('disable-renderer-backgrounding')
  process.on('disconnect', () => app.exit(0))
  let win: BrowserWindow | null = null
  let loaded = false
  const queued: unknown[] = []
  const forward = (message: unknown) => {
    if (win && loaded && !win.isDestroyed()) win.webContents.send('karaoke-helper:command', message)
    else queued.push(message)
  }

  process.once('message', (init: unknown) => {
    if (!isInit(init)) {
      app.exit(1)
      return
    }
    process.on('message', forward)
    void app.whenReady().then(() => {
      session.defaultSession.setPermissionCheckHandler(() => false)
      session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
      const created = new BrowserWindow({
        width: 1, height: 1, show: false, paintWhenInitiallyHidden: false,
        webPreferences: {
          preload: join(import.meta.dirname, '../preload/karaoke-helper.cjs'),
          contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false,
          additionalArguments: [`--simplemusic-server-port=${init.port}`, `--simplemusic-server-token=${init.token}`]
        }
      })
      win = created
      const native = createNativeInference(init.userDataDir)
      const trusted = (event: Electron.IpcMainInvokeEvent) => !created.isDestroyed() && event.sender === created.webContents
        && event.senderFrame === created.webContents.mainFrame
      ipcMain.handle('karaoke-helper:native-init', (event, model: unknown) => {
        if (!trusted(event) || !isKaraokeModelId(model)) throw new Error('无效的分离请求')
        return native.init(model)
      })
      ipcMain.handle('karaoke-helper:native-infer', (event, input: Float32Array) => {
        if (!trusted(event)) throw new Error('无效的分离请求')
        return native.infer(input)
      })
      created.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      created.webContents.on('will-navigate', event => event.preventDefault())
      // 页面崩溃后直接退出，由主进程把在途任务判为失败，下次分离时重新拉起
      created.webContents.on('render-process-gone', () => app.exit(1))
      ipcMain.on('karaoke-helper:event', (event, message: unknown) => {
        if (event.sender === created.webContents) process.send?.(message)
      })
      ipcMain.on('karaoke-helper:ready', (event) => {
        if (event.sender !== created.webContents) return
        loaded = true
        for (const message of queued.splice(0)) forward(message)
      })
      void created.loadURL(resolveRendererUrl('karaoke-helper.html')).catch(() => app.exit(1))
    })
  })
}
