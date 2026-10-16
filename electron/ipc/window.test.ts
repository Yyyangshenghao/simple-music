import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  main: { isDestroyed: () => false, webContents: { mainFrame: {} } },
  get: vi.fn(() => ({ behavior: 'ask', promptId: null })), set: vi.fn(), resolve: vi.fn(),
  isHost: vi.fn(() => false), gameEnabled: false, setGameMode: vi.fn(),
  returnFromMiniPlayer: vi.fn(), setModalOpen: vi.fn()
}))
vi.mock('electron', () => ({ ipcMain: { handle: (name: string, cb: (...args: any[]) => any) => h.handlers.set(name, cb) } }))
vi.mock('../modules/window-manager', () => ({ getMainWindow: () => h.main, setModalOpen: h.setModalOpen }))
vi.mock('../modules/window-close', () => ({ getWindowCloseState: h.get, setWindowCloseBehavior: h.set, resolveWindowClose: h.resolve }))
vi.mock('../modules/playback-host', () => ({ isPlaybackHostEvent: h.isHost }))
vi.mock('../modules/game-mode', () => ({ getGameMode: () => ({ enabled: h.gameEnabled }), setGameMode: h.setGameMode }))
vi.mock('../modules/overlay-manager', () => ({ returnFromMiniPlayer: h.returnFromMiniPlayer }))

describe('窗口 IPC 边界', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    h.handlers.clear()
    h.isHost.mockReturnValue(false)
    h.gameEnabled = false
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

  it.each([false, true])('宿主显示主窗口时按需退出游戏模式（enabled=%s）并收起迷你条', (enabled) => {
    const event = { sender: {}, senderFrame: {} }
    h.isHost.mockReturnValue(true)
    h.gameEnabled = enabled
    h.handlers.get('window:show')!(event)
    expect(h.isHost).toHaveBeenCalledWith(event)
    expect(h.returnFromMiniPlayer).toHaveBeenCalledOnce()
    if (enabled) {
      expect(h.setGameMode).toHaveBeenCalledWith({ enabled: false }, false)
      expect(h.setGameMode.mock.invocationCallOrder[0]).toBeLessThan(h.returnFromMiniPlayer.mock.invocationCallOrder[0])
    } else expect(h.setGameMode).not.toHaveBeenCalled()
  })

  it('非宿主无法显示主窗口或改变游戏模式', () => {
    h.gameEnabled = true
    const mainEvent = { sender: h.main.webContents, senderFrame: h.main.webContents.mainFrame }
    expect(() => h.handlers.get('window:show')!(mainEvent)).toThrow('Only the playback host')
    expect(h.setGameMode).not.toHaveBeenCalled()
    expect(h.returnFromMiniPlayer).not.toHaveBeenCalled()
  })

  it.each(['win32', 'darwin', 'linux'])('主窗口可在 %s 同步明确的模态状态', (platform) => {
    vi.stubGlobal('process', { ...process, platform })
    const event = { sender: h.main.webContents, senderFrame: h.main.webContents.mainFrame }
    const handle = h.handlers.get('window:set-modal-open')!
    handle(event, true)
    handle(event, false)
    expect(h.setModalOpen.mock.calls).toEqual([[true], [false]])
  })

  it('模态状态拒绝其他窗口、子 frame 和非布尔参数', () => {
    const handle = h.handlers.get('window:set-modal-open')!
    expect(() => handle({ sender: {}, senderFrame: h.main.webContents.mainFrame }, true)).toThrow()
    expect(() => handle({ sender: h.main.webContents, senderFrame: {} }, true)).toThrow()
    const event = { sender: h.main.webContents, senderFrame: h.main.webContents.mainFrame }
    for (const value of [undefined, null, 0, 'true', {}]) expect(() => handle(event, value)).toThrow('Invalid modal state')
    expect(h.setModalOpen).not.toHaveBeenCalled()
  })
})
