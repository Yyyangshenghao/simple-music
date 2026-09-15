import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  events: new Map<string, () => void>(),
  main: null as null | {
    isDestroyed(): boolean
    hide(): void
    on(event: string, listener: (event: { preventDefault(): void }) => void): void
  },
  windowEvents: new Map<string, (event: { preventDefault(): void }) => void>(),
  hide: vi.fn(),
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
    requestSingleInstanceLock: () => true, whenReady: () => Promise.resolve(), quit: vi.fn(),
    on: (event: string, listener: () => void) => h.events.set(event, listener)
  },
  BrowserWindow: { getAllWindows: () => h.windows },
  screen: { on: vi.fn() },
  session: { defaultSession: { setPermissionRequestHandler: vi.fn() } }
}))
vi.mock('./server-host', () => ({ bootServer: h.bootServer, shutdownServer: h.shutdown }))
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

describe('主窗口激活恢复', () => {
  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.stubGlobal('process', { ...process, platform: 'darwin' })
    h.events.clear()
    h.windowEvents.clear()
    h.main = null
    h.windows = []
    h.registerIpc.mockImplementationOnce(() => {}).mockImplementation(() => {
      throw new Error('IPC handler already registered')
    })
    h.createMainWindow.mockImplementation(() => {
      h.main = {
        isDestroyed: () => false,
        hide: h.hide,
        on: (event, listener) => { h.windowEvents.set(event, listener) }
      }
      h.windows = [h.main]
      return h.main
    })
    await import('./main')
    await flush()
  })

  afterEach(() => vi.unstubAllGlobals())

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

  it('Windows 保留原有关闭行为', async () => {
    vi.resetModules()
    vi.stubGlobal('process', { ...process, platform: 'win32' })
    h.windowEvents.clear()
    h.registerIpc.mockImplementationOnce(() => {})
    await import('./main')
    await flush()
    expect(h.windowEvents.has('close')).toBe(false)
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
