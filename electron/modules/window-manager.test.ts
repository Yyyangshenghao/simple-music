import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  input: undefined as undefined | ((event: { preventDefault(): void }, input: { type: string; key: string }) => void),
  pendingClose: false, fullscreen: true, setFullscreen: vi.fn(),
  display: { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 } }
}))
vi.mock('electron', () => ({
  screen: { getPrimaryDisplay: () => h.display },
  BrowserWindow: class {
    webContents = {
      setWindowOpenHandler: vi.fn(), once: vi.fn(),
      on: (event: string, listener: typeof h.input) => { if (event === 'before-input-event') h.input = listener }
    }
    on = vi.fn()
    once = vi.fn()
    loadURL = vi.fn()
    isFullScreen = () => h.fullscreen
    isDestroyed = () => false
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
    h.pendingClose = false
    h.fullscreen = true
    const { createMainWindow } = await import('./window-manager')
    createMainWindow(35530)
  })
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals() })

  it('Windows 全屏有关闭确认时让行 Esc，交给对话框取消', () => {
    h.pendingClose = true
    const event = { preventDefault: vi.fn() }
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
