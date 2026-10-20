import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  input: undefined as undefined | ((event: { preventDefault(): void }, input: { type: string; key: string }) => void),
  windows: [] as any[],
  fullscreen: true, setFullscreen: vi.fn(),
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
      setIgnoreMenuShortcuts: vi.fn(),
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

describe('主窗口生命周期与键盘隔离', () => {
  beforeEach(async () => {
    vi.resetModules()
    vi.useFakeTimers()
    vi.clearAllMocks()
    vi.stubGlobal('process', { ...process, platform: 'win32' })
    h.input = undefined
    h.windows = []
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

  it.each(['win32', 'darwin', 'linux'])('%s 全屏时 Esc 交给已配置快捷键，不在主进程强制退出全屏', (platform) => {
    vi.stubGlobal('process', { ...process, platform })
    const event = { preventDefault: vi.fn() }
    h.input?.(event, { type: 'keyDown', key: 'Escape' })
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(h.setFullscreen).not.toHaveBeenCalled()
  })

  it('快捷键录入暂停原生菜单，结束后恢复系统及菜单组合', async () => {
    const manager = await import('./window-manager')
    const ignore = h.windows[0].webContents.setIgnoreMenuShortcuts
    manager.setShortcutRecording(true)
    expect(ignore).toHaveBeenLastCalledWith(true)
    manager.setShortcutRecording(false)
    expect(ignore).toHaveBeenLastCalledWith(false)
  })
})
