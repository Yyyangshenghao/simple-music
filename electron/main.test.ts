import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { app, session } from 'electron'

const h = vi.hoisted(() => ({
  events: new Map<string, (event?: { preventDefault(): void }) => void>(),
  main: null as null | {
    isDestroyed(): boolean
    hide(): void
    webContents: { mainFrame: object }
    on(event: string, listener: (event: { preventDefault(): void }) => void): void
  },
  appleFrame: { id: 'apple-frame' },
  captureFrame: vi.fn(),
  windowEvents: new Map<string, (event: { preventDefault(): void }) => void>(),
  hide: vi.fn(),
  showMessageBox: vi.fn(async () => ({ response: 2, checkboxChecked: false })),
  windows: [] as object[],
  registerIpc: vi.fn(),
  bootServer: vi.fn(async () => ({ port: 35530, token: 'test-token' })),
  createMainWindow: vi.fn(),
  createTray: vi.fn(),
  restore: vi.fn(),
  shutdown: vi.fn()
}))
vi.mock('electron', () => ({
  app: {
    commandLine: { appendSwitch: vi.fn() }, setName: vi.fn(), setAppUserModelId: vi.fn(),
    requestSingleInstanceLock: () => true, whenReady: () => Promise.resolve(), quit: vi.fn(), exit: vi.fn(),
    on: (event: string, listener: (event?: { preventDefault(): void }) => void) => h.events.set(event, listener)
  },
  BrowserWindow: { getAllWindows: () => h.windows },
  dialog: { showMessageBox: h.showMessageBox },
  screen: { on: vi.fn() },
  session: { defaultSession: { setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn(), setDisplayMediaRequestHandler: vi.fn() } }
}))
vi.mock('./server-host', () => ({ bootServer: h.bootServer, shutdownServer: h.shutdown, getAppleMusicCaptureFrame: h.captureFrame }))
vi.mock('./ipc', () => ({ registerIpc: h.registerIpc }))
vi.mock('./modules/window-manager', () => ({
  getMainWindow: () => h.main, createMainWindow: h.createMainWindow,
  getServerPort: () => 35530, getServerToken: () => 'test-token', scheduleWindowStateSend: vi.fn()
}))
vi.mock('./modules/overlay-manager', () => ({
  returnFromMiniPlayer: h.restore, closeOverlays: vi.fn(),
  positionDesktopLyricsWindow: vi.fn(), positionWallpaperWindow: vi.fn()
}))
vi.mock('./modules/hotkey-manager', () => ({ unregisterHotkeys: vi.fn() }))
vi.mock('./modules/tray-manager', () => ({ createTray: h.createTray, destroyTray: vi.fn() }))

async function flush() {
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

async function bootWindows() {
  vi.resetModules()
  vi.stubGlobal('process', { ...process, platform: 'win32' })
  h.windowEvents.clear()
  h.registerIpc.mockImplementationOnce(() => {})
  await import('./main')
  await flush()
}

describe('主窗口激活恢复', () => {
  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    h.showMessageBox.mockResolvedValue({ response: 2, checkboxChecked: false })
    vi.stubGlobal('process', { ...process, platform: 'darwin' })
    h.events.clear()
    h.windowEvents.clear()
    h.main = null
    h.windows = []
    h.captureFrame.mockReturnValue(h.appleFrame)
    h.registerIpc.mockImplementationOnce(() => {}).mockImplementation(() => {
      throw new Error('IPC handler already registered')
    })
    h.createMainWindow.mockImplementation(() => {
      h.main = {
        isDestroyed: () => false,
        hide: h.hide,
        webContents: { mainFrame: { id: 'main-frame' } },
        on: (event, listener) => { h.windowEvents.set(event, listener) }
      }
      h.windows = [h.main]
      return h.main
    })
    await import('./main')
    await flush()
  })

  afterEach(() => { h.events.get('will-quit')?.(); vi.useRealTimers(); vi.unstubAllGlobals() })

  it('关闭服务卡住时退出兜底释放主进程，不永久占用单实例锁', async () => {
    vi.useFakeTimers()
    h.shutdown.mockImplementationOnce(() => new Promise<void>(() => {}))
    h.events.get('before-quit')!({ preventDefault: vi.fn() })
    await vi.advanceTimersByTimeAsync(8000)
    expect(app.exit).toHaveBeenCalledWith(0)
  })

  it('服务关闭报错仍继续退出，正常退出后取消兜底', async () => {
    vi.useFakeTimers()
    h.shutdown.mockRejectedValueOnce(new Error('cleanup failed'))
    h.events.get('before-quit')!({ preventDefault: vi.fn() })
    await vi.advanceTimersByTimeAsync(0)
    expect(app.quit).toHaveBeenCalledOnce()
    h.events.get('will-quit')?.()
    await vi.advanceTimersByTimeAsync(8000)
    expect(app.exit).not.toHaveBeenCalled()
  })

  it('macOS 关闭主窗口仅隐藏，保留承载播放的窗口和服务', () => {
    const win = h.main
    const preventDefault = vi.fn()
    expect(h.windowEvents.has('close')).toBe(true)
    h.windowEvents.get('close')!({ preventDefault })
    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(h.hide).toHaveBeenCalledTimes(1)
    expect(h.main).toBe(win)
    expect(h.shutdown).not.toHaveBeenCalled()
  })

  it('只允许主窗口捕获 Apple Music 音频，且保留原窗口出声', () => {
    const request = vi.mocked(session.defaultSession.setPermissionRequestHandler).mock.calls.at(-1)![0]!
    const display = vi.mocked(session.defaultSession.setDisplayMediaRequestHandler).mock.calls.at(-1)![0]!
    const callback = vi.fn()
    request(h.main!.webContents as Electron.WebContents, 'display-capture', callback, {} as never)
    expect(callback).toHaveBeenCalledWith(true)
    display({ frame: h.main!.webContents.mainFrame, audioRequested: true, videoRequested: true } as never, callback)
    expect(callback).toHaveBeenLastCalledWith({ video: h.main!.webContents.mainFrame, audio: h.appleFrame, enableLocalEcho: true })
    display({ frame: { id: 'foreign' }, audioRequested: true, videoRequested: true } as never, callback)
    expect(callback).toHaveBeenLastCalledWith(null)
    h.captureFrame.mockReturnValue(null)
    request(h.main!.webContents as Electron.WebContents, 'display-capture', callback, {} as never)
    expect(callback).toHaveBeenLastCalledWith(false)
  })

  it('macOS 隐藏后激活复用原窗口，不重建播放会话', async () => {
    expect(h.windowEvents.has('close')).toBe(true)
    h.windowEvents.get('close')!({ preventDefault: vi.fn() })
    h.events.get('activate')!()
    await flush()
    expect(h.restore).toHaveBeenCalledTimes(1)
    expect(h.createMainWindow).toHaveBeenCalledTimes(1)
  })

  it('macOS 真正退出时允许关闭窗口，不再隐藏', () => {
    h.events.get('before-quit')!()
    const preventDefault = vi.fn()
    expect(h.windowEvents.has('close')).toBe(true)
    h.windowEvents.get('close')!({ preventDefault })
    expect(preventDefault).not.toHaveBeenCalled()
    expect(h.hide).not.toHaveBeenCalled()
    expect(h.shutdown).toHaveBeenCalledTimes(1)
  })

  it('退出等待官网浏览器关闭，重复退出不跳过清理', async () => {
    let finish!: () => void
    h.shutdown.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
    const preventDefault = vi.fn()
    h.events.get('before-quit')!({ preventDefault })
    h.events.get('before-quit')!({ preventDefault })
    expect(preventDefault).toHaveBeenCalledTimes(2)
    expect(h.shutdown).toHaveBeenCalledOnce()
    expect(app.quit).not.toHaveBeenCalled()
    finish()
    await flush()
    expect(app.quit).toHaveBeenCalledOnce()
    h.events.get('before-quit')!({ preventDefault })
    expect(preventDefault).toHaveBeenCalledTimes(2)
  })

  it('Windows 关闭前询问，缩回托盘保留窗口和播放服务', async () => {
    await bootWindows()
    h.showMessageBox.mockResolvedValueOnce({ response: 0, checkboxChecked: false })
    const win = h.main
    const preventDefault = vi.fn()
    h.windowEvents.get('close')!({ preventDefault })
    await flush()
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(h.showMessageBox).toHaveBeenCalledWith(win, expect.objectContaining({
      buttons: ['缩回托盘', '退出应用', '取消'], defaultId: 0, cancelId: 2
    }))
    expect(h.hide).toHaveBeenCalledOnce()
    expect(h.main).toBe(win)
    expect(app.quit).not.toHaveBeenCalled()
    expect(h.shutdown).not.toHaveBeenCalled()
  })

  it('Windows 选择退出应用走现有退出入口，不直接销毁窗口', async () => {
    await bootWindows()
    h.showMessageBox.mockResolvedValueOnce({ response: 1, checkboxChecked: false })
    h.windowEvents.get('close')!({ preventDefault: vi.fn() })
    await flush()
    expect(app.quit).toHaveBeenCalledOnce()
    expect(h.hide).not.toHaveBeenCalled()
  })

  it('Windows 取消保留主窗口，下次关闭仍询问', async () => {
    await bootWindows()
    h.windowEvents.get('close')!({ preventDefault: vi.fn() })
    await flush()
    expect(h.hide).not.toHaveBeenCalled()
    expect(app.quit).not.toHaveBeenCalled()
    h.windowEvents.get('close')!({ preventDefault: vi.fn() })
    await flush()
    expect(h.showMessageBox).toHaveBeenCalledTimes(2)
  })

  it('Windows 连续关闭只显示一个询问框', async () => {
    await bootWindows()
    let finish!: (value: { response: number; checkboxChecked: boolean }) => void
    h.showMessageBox.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const preventDefault = vi.fn()
    h.windowEvents.get('close')!({ preventDefault })
    h.windowEvents.get('close')!({ preventDefault })
    expect(preventDefault).toHaveBeenCalledTimes(2)
    expect(h.showMessageBox).toHaveBeenCalledOnce()
    finish({ response: 2, checkboxChecked: false })
    await flush()
  })

  it('Windows 主动退出时放行关闭，不再弹框', async () => {
    await bootWindows()
    h.events.get('before-quit')!({ preventDefault: vi.fn() })
    const preventDefault = vi.fn()
    h.windowEvents.get('close')!({ preventDefault })
    expect(preventDefault).not.toHaveBeenCalled()
    expect(h.showMessageBox).not.toHaveBeenCalled()
    expect(h.hide).not.toHaveBeenCalled()
    expect(h.shutdown).toHaveBeenCalledOnce()
  })

  it.each(['退出中', '已销毁'])('Windows 询问期间窗口%s时丢弃结果', async (state) => {
    await bootWindows()
    let finish!: (value: { response: number; checkboxChecked: boolean }) => void
    h.showMessageBox.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    h.windowEvents.get('close')!({ preventDefault: vi.fn() })
    if (state === '退出中') h.events.get('before-quit')!({ preventDefault: vi.fn() })
    else h.main!.isDestroyed = () => true
    finish({ response: 0, checkboxChecked: false })
    await flush()
    expect(h.hide).not.toHaveBeenCalled()
  })

  it('Windows 询问失败保留窗口并允许重试', async () => {
    await bootWindows()
    const error = new Error('dialog failed')
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      h.showMessageBox.mockRejectedValueOnce(error)
      h.windowEvents.get('close')!({ preventDefault: vi.fn() })
      await flush()
      expect(h.hide).not.toHaveBeenCalled()
      expect(app.quit).not.toHaveBeenCalled()
      expect(log).toHaveBeenCalledWith('Window close confirmation failed:', error)
      h.windowEvents.get('close')!({ preventDefault: vi.fn() })
      await flush()
      expect(h.showMessageBox).toHaveBeenCalledTimes(2)
    } finally {
      log.mockRestore()
    }
  })

  it('Windows 主窗口已关闭时仍退出，不被隐藏的 Apple Music 窗口阻塞', async () => {
    await bootWindows()
    expect(h.windowEvents.has('closed')).toBe(true)
    h.windowEvents.get('closed')!({ preventDefault: vi.fn() })
    expect(app.quit).toHaveBeenCalledOnce()
  })

  it.each(['activate', 'second-instance'])('%s 在关闭后重建主窗口，不重复初始化', async (event) => {
    for (let i = 0; i < 3; i++) {
      h.main = null
      h.windows = []
      h.events.get(event)!()
      await flush()
      expect(h.main).not.toBeNull()
    }
    expect(h.registerIpc).toHaveBeenCalledTimes(1)
    expect(h.bootServer).toHaveBeenCalledTimes(1)
    expect(h.createTray).toHaveBeenCalledTimes(1)
    expect(h.createMainWindow).toHaveBeenLastCalledWith(35530, 'test-token')
  })

  it('仅有悬浮窗时仍重建主窗口', async () => {
    h.main = null
    h.windows = [{}]
    h.events.get('activate')!()
    await flush()
    expect(h.createMainWindow).toHaveBeenCalledTimes(2)
    expect(h.main).not.toBeNull()
  })

  it('已有主窗口时调用现有的迷你播放器退出及聚焦逻辑', async () => {
    h.events.get('activate')!()
    await flush()
    expect(h.restore).toHaveBeenCalledTimes(1)
    expect(h.createMainWindow).toHaveBeenCalledTimes(1)
  })

  it('再次启动应用时复用主窗口并退出迷你模式，不重建服务与托盘', async () => {
    h.events.get('second-instance')!()
    await flush()
    expect(h.restore).toHaveBeenCalledOnce()
    expect(h.createMainWindow).toHaveBeenCalledOnce()
    expect(h.bootServer).toHaveBeenCalledOnce()
    expect(h.createTray).toHaveBeenCalledOnce()
    expect(h.registerIpc).toHaveBeenCalledOnce()
  })

  it('连续激活只创建一个主窗口', async () => {
    h.main = null
    h.windows = []
    h.events.get('activate')!()
    h.events.get('activate')!()
    await flush()
    expect(h.createMainWindow).toHaveBeenCalledTimes(2)
  })

  it('启动尚未完成时激活，不重复启动服务或创建窗口', async () => {
    vi.resetModules()
    vi.clearAllMocks()
    h.main = null
    let finish!: (value: { port: number; token: string }) => void
    h.bootServer.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    h.registerIpc.mockImplementationOnce(() => {})
    await import('./main')
    h.events.get('activate')!()
    h.events.get('second-instance')!()
    expect(h.createMainWindow).not.toHaveBeenCalled()
    finish({ port: 35530, token: 'test-token' })
    await flush()
    expect(h.bootServer).toHaveBeenCalledTimes(1)
    expect(h.registerIpc).toHaveBeenCalledTimes(1)
    expect(h.createMainWindow).toHaveBeenCalledTimes(1)
  })

  it('服务启动期间退出，完成启动后也不会创建窗口或托盘', async () => {
    vi.resetModules()
    vi.clearAllMocks()
    h.main = null
    let finish!: (value: { port: number; token: string }) => void
    h.bootServer.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    h.registerIpc.mockImplementationOnce(() => {})
    await import('./main')
    h.events.get('activate')!()
    h.events.get('before-quit')!()
    finish({ port: 35530, token: 'test-token' })
    await flush()
    expect(h.createMainWindow).not.toHaveBeenCalled()
    expect(h.createTray).not.toHaveBeenCalled()
    expect(h.shutdown).toHaveBeenCalledTimes(2)
  })

  it('退出后不再恢复窗口', async () => {
    h.events.get('before-quit')!()
    h.main = null
    h.events.get('activate')!()
    await flush()
    expect(h.createMainWindow).toHaveBeenCalledTimes(1)
    expect(h.shutdown).toHaveBeenCalledTimes(1)
  })
})
