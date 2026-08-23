import { beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => {
  const instances: Array<{
    bounds: Electron.Rectangle
    listeners: Map<string, () => void>
    setBounds: ReturnType<typeof vi.fn>
    setResizable: ReturnType<typeof vi.fn>
  }> = []
  const mainSend = vi.fn()

  const BrowserWindow = vi.fn(function (options: Electron.BrowserWindowConstructorOptions) {
    const listeners = new Map<string, () => void>()
    const win = {
      bounds: {
        x: options.x ?? 0,
        y: options.y ?? 0,
        width: options.width ?? 0,
        height: options.height ?? 0
      },
      listeners,
      webContents: {
        setWindowOpenHandler: vi.fn(),
        on: vi.fn(),
        once: vi.fn(),
        send: vi.fn()
      },
      isDestroyed: vi.fn(() => false),
      setAlwaysOnTop: vi.fn(),
      setVisibleOnAllWorkspaces: vi.fn(),
      showInactive: vi.fn(),
      close: vi.fn(),
      setResizable: vi.fn(),
      getBounds: vi.fn(() => ({ ...win.bounds })),
      setBounds: vi.fn((bounds: Electron.Rectangle) => {
        win.bounds = { ...bounds }
      }),
      once: vi.fn(),
      on: vi.fn((event: string, listener: () => void) => {
        listeners.set(event, listener)
      }),
      loadURL: vi.fn(() => Promise.resolve())
    }
    instances.push(win)
    return win
  })

  return { BrowserWindow, instances, mainSend }
})

vi.mock('electron', () => ({
  BrowserWindow: harness.BrowserWindow,
  screen: {
    getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
    getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } })
  }
}))

vi.mock('./window-manager', () => ({
  getMainWindow: () => ({ isDestroyed: () => false, webContents: { send: harness.mainSend } }),
  resolveRendererUrl: () => 'file:///mini-player.html',
  hideMainWindow: vi.fn(),
  focusMainWindow: vi.fn(),
  isInAppUrl: () => true
}))

vi.mock('./safe-open', () => ({ openExternalSafely: vi.fn() }))
vi.mock('../platform', () => ({
  getPlatform: () => ({
    startMousePoller: vi.fn(),
    stopMousePoller: vi.fn(),
    attachWallpaperToDesktop: vi.fn(),
    ensureDesktopShortcut: vi.fn()
  })
}))

import { moveMiniPlayerBy, resizeMiniPlayerBy, setMiniPlayerEnabled } from './overlay-manager'

describe('迷你播放器窗口尺寸', () => {
  beforeEach(() => {
    setMiniPlayerEnabled(false)
    harness.instances.length = 0
    harness.mainSend.mockReset()
  })

  it('移动时保持用户设置的宽度，不吸收平台上报的瞬时宽度漂移', () => {
    setMiniPlayerEnabled(true, 360)
    const win = harness.instances[0]

    win.bounds = { ...win.bounds, width: 361 }
    win.listeners.get('moved')?.()
    moveMiniPlayerBy(12, 8)

    expect(harness.mainSend).not.toHaveBeenCalledWith('miniplayer:width-changed', expect.anything())
    expect(win.setBounds).toHaveBeenLastCalledWith(
      { x: 1548, y: 984, width: 360, height: 80 },
      false
    )
  })

  it('缩放以用户宽度为基准，且非 macOS 不临时开启系统边缘缩放', () => {
    setMiniPlayerEnabled(true, 360)
    const win = harness.instances[0]

    win.bounds = { ...win.bounds, width: 361 }
    resizeMiniPlayerBy(20)

    expect(win.setBounds).toHaveBeenLastCalledWith(
      expect.objectContaining({ width: 380, height: 80 }),
      false
    )
    expect(harness.mainSend).toHaveBeenLastCalledWith('miniplayer:width-changed', { width: 380 })
    if (process.platform !== 'darwin') expect(win.setResizable).not.toHaveBeenCalled()
  })

  it('单次快速拖动也能覆盖完整宽度范围', () => {
    setMiniPlayerEnabled(true, 760)
    const win = harness.instances[0]

    resizeMiniPlayerBy(-1000)

    expect(win.setBounds).toHaveBeenLastCalledWith(
      expect.objectContaining({ width: 300, height: 80 }),
      false
    )
    expect(harness.mainSend).toHaveBeenLastCalledWith('miniplayer:width-changed', { width: 300 })
  })
})
