import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  main: { isDestroyed: () => false, webContents: { mainFrame: {} } },
  get: vi.fn(() => ({ behavior: 'ask', promptId: null })), set: vi.fn(), resolve: vi.fn()
}))
vi.mock('electron', () => ({ ipcMain: { handle: (name: string, cb: (...args: any[]) => any) => h.handlers.set(name, cb) } }))
vi.mock('../modules/window-manager', () => ({ getMainWindow: () => h.main }))
vi.mock('../modules/window-close', () => ({ getWindowCloseState: h.get, setWindowCloseBehavior: h.set, resolveWindowClose: h.resolve }))

describe('关闭偏好 IPC 边界', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    h.handlers.clear()
    vi.stubGlobal('process', { ...process, platform: 'win32' })
    const { registerWindowIpc } = await import('./window')
    registerWindowIpc()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('只接受 Windows 主窗口主 frame，转发明确选择', () => {
    const event = { sender: h.main.webContents, senderFrame: h.main.webContents.mainFrame }
    const choice = { promptId: 1, action: 'quit', remember: true }
    h.handlers.get('window:get-close-state')!(event)
    h.handlers.get('window:set-close-behavior')!(event, 'tray')
    h.handlers.get('window:resolve-close')!(event, choice)
    expect(h.get).toHaveBeenCalledOnce()
    expect(h.set).toHaveBeenCalledWith('tray')
    expect(h.resolve).toHaveBeenCalledWith(choice)
  })

  it.each(['window:get-close-state', 'window:set-close-behavior', 'window:resolve-close'])('%s 拒绝外部窗口、子 frame 和其他平台', (channel) => {
    const handle = h.handlers.get(channel)!
    expect(() => handle({ sender: {}, senderFrame: h.main.webContents.mainFrame }, 'quit')).toThrow()
    expect(() => handle({ sender: h.main.webContents, senderFrame: {} }, 'quit')).toThrow()
    vi.stubGlobal('process', { ...process, platform: 'darwin' })
    expect(() => handle({ sender: h.main.webContents, senderFrame: h.main.webContents.mainFrame }, 'quit')).toThrow()
    expect(h.set).not.toHaveBeenCalled()
    expect(h.resolve).not.toHaveBeenCalled()
  })
})
