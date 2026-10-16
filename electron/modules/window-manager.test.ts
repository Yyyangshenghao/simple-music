import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  input: undefined as undefined | ((event: { preventDefault(): void }, input: { type: string; key: string }) => void),
  windows: [] as any[],
  pendingClose: false, fullscreen: true, setFullscreen: vi.fn(),
  display: { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 } }
}))
vi.mock('electron', () => ({
  screen: { getPrimaryDisplay: () => h.display, getDisplayMatching: () => h.display, getAllDisplays: () => [h.display] },
  BrowserWindow: class {
    events = new Map<string, (...args: any[]) => void>()
    destroyed = false
    constructor() { h.windows.push(this) }
    webContents = {
      setWindowOpenHandler: vi.fn(), once: vi.fn(), send: vi.fn(), isLoadingMainFrame: () => false,
      on: (event: string, listener: typeof h.input) => { if (event === 'before-input-event') h.input = listener }
    }
    on = (name: string, fn: (...args: any[]) => void) => { this.events.set(name, fn) }
    once = this.on
    destroy = () => { this.destroyed = true; this.events.get('closed')?.() }
    getNormalBounds = () => ({ x: 50, y: 50, width: 1000, height: 600 })
    show = vi.fn()
    focus = vi.fn()
    isMinimized = () => false
    isVisible = () => true
    isFocused = () => false
    isMaximized = () => false
    getBounds = this.getNormalBounds
    loadURL = vi.fn()
    isFullScreen = () => h.fullscreen
    isDestroyed = () => this.destroyed
    setFullScreen = h.setFullscreen
  }
}))
vi.mock('./safe-open', () => ({ openExternalSafely: vi.fn() }))
vi.mock('./window-close', () => ({ isWindowClosePending: () => h.pendingClose }))

describe('全屏窗口的 Esc 与关闭确认', () => {
  beforeEach(async () => {
    vi.resetModules()
    vi.useFakeTimers()
    vi.clearAllMocks()
    vi.stubGlobal('process', { ...process, platform: 'win32' })
    h.windows = []
    h.pendingClose = false
    h.fullscreen = true
    const { createMainWindow } = await import('./window-manager')
    createMainWindow(35530)
  })
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals() })

  it('游戏模式释放 UI 后统一恢复入口只创建一次，并保留原窗口尺寸', async () => {
    const manager = await import('./window-manager')
    const first = h.windows[0]
    const restore = vi.fn(() => { manager.createMainWindow(35530) })
    manager.setMainWindowRestorer(restore)
    expect(manager.releaseMainWindow()).toBe(true)
    expect(manager.getMainWindow()).toBeNull()
    expect(manager.isReleasedMainWindow(first)).toBe(true)
    expect(manager.focusMainWindow()).toBe(true)
    expect(manager.focusMainWindow()).toBe(true)
    expect(restore).toHaveBeenCalledOnce()
    expect(h.windows).toHaveLength(2)
  })

  it('旧窗口迟到的关闭和显示回调不清空或显示新窗口', async () => {
    const manager = await import('./window-manager')
    const first = h.windows[0]
    const second = manager.createMainWindow(35530)
    first.events.get('closed')()
    first.events.get('ready-to-show')()
    expect(manager.getMainWindow()).toBe(second)
    expect(first.show).not.toHaveBeenCalled()
    expect((second as any).show).not.toHaveBeenCalled()
  })

  it('Windows 全屏有关闭确认时让行 Esc，交给对话框取消', () => {
    h.pendingClose = true
    const event = { preventDefault: vi.fn() }
    h.input!(event, { type: 'keyDown', key: 'Escape' })
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(h.setFullscreen).not.toHaveBeenCalled()
  })

  it.each(['win32', 'darwin', 'linux'])('%s 全屏有界面模态框时让行 Esc，关闭后恢复退出全屏', async (platform) => {
    vi.stubGlobal('process', { ...process, platform })
    const { setModalOpen } = await import('./window-manager')
    const event = { preventDefault: vi.fn() }
    setModalOpen(true)
    h.input!(event, { type: 'keyDown', key: 'Escape' })
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(h.setFullscreen).not.toHaveBeenCalled()
    setModalOpen(false)
    h.input!(event, { type: 'keyDown', key: 'Escape' })
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(h.setFullscreen).toHaveBeenCalledWith(false)
  })

  it('重建主窗口清除旧模态状态，迟到的旧窗口关闭不清除新窗口模态状态', async () => {
    const manager = await import('./window-manager')
    const first = h.windows[0]
    manager.setModalOpen(true)
    manager.createMainWindow(35530)
    const event = { preventDefault: vi.fn() }
    h.input!(event, { type: 'keyDown', key: 'Escape' })
    expect(event.preventDefault).toHaveBeenCalledOnce()
    vi.clearAllMocks()
    manager.setModalOpen(true)
    first.events.get('closed')()
    h.input!(event, { type: 'keyDown', key: 'Escape' })
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(h.setFullscreen).not.toHaveBeenCalled()
  })

  it('没有确认框时仍用 Esc 退出全屏', () => {
    const event = { preventDefault: vi.fn() }
    h.input!(event, { type: 'keyDown', key: 'Escape' })
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(h.setFullscreen).toHaveBeenCalledWith(false)
  })

  it('其他平台保留原有的退出全屏行为', () => {
    vi.stubGlobal('process', { ...process, platform: 'darwin' })
    h.pendingClose = true
    const event = { preventDefault: vi.fn() }
    h.input!(event, { type: 'keyDown', key: 'Escape' })
    expect(h.setFullscreen).toHaveBeenCalledWith(false)
  })
})
