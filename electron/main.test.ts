import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  events: new Map<string, () => void>(),
  main: null as null | { isDestroyed(): boolean },
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
    h.events.clear()
    h.main = null
    h.windows = []
    h.registerIpc.mockImplementationOnce(() => {}).mockImplementation(() => {
      throw new Error('IPC handler already registered')
    })
    h.createMainWindow.mockImplementation(() => {
      h.main = { isDestroyed: () => false }
      h.windows = [h.main]
      return h.main
    })
    await import('./main')
    await flush()
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
