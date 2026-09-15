import { beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => {
  const instances: Array<{
    bounds: Electron.Rectangle
    listeners: Map<string, () => void>
    close: ReturnType<typeof vi.fn>
    setBounds: ReturnType<typeof vi.fn>
    setResizable: ReturnType<typeof vi.fn>
  }> = []
  const mainSend = vi.fn()
  const hideMainWindow = vi.fn()
  const focusMainWindow = vi.fn()

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

  return { BrowserWindow, instances, mainSend, hideMainWindow, focusMainWindow }
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
  hideMainWindow: harness.hideMainWindow,
  focusMainWindow: harness.focusMainWindow,
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

import { moveMiniPlayerBy, resizeMiniPlayerBy, returnFromMiniPlayer, setMiniPlayerEnabled } from './overlay-manager'

describe('迷你播放器窗口尺寸', () => {
  beforeEach(() => {
    setMiniPlayerEnabled(false)
    harness.instances.length = 0
    harness.mainSend.mockReset()
    harness.hideMainWindow.mockReset()
    harness.focusMainWindow.mockReset()
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

  it('保留后台节流，避免被遮挡时高频刷新', () => {
    setMiniPlayerEnabled(true, 360)

    expect(harness.BrowserWindow).toHaveBeenLastCalledWith(
      expect.objectContaining({
        webPreferences: expect.objectContaining({ backgroundThrottling: true })
      })
    )
  })

  it('退出迷你模式时关闭迷你窗口、同步设置并聚焦主窗口', () => {
    setMiniPlayerEnabled(true, 360)
    const win = harness.instances[0]

    returnFromMiniPlayer()

    expect(win.close).toHaveBeenCalledOnce()
    expect(harness.mainSend).toHaveBeenCalledWith('miniplayer:control', { action: 'sync-off' })
    expect(harness.focusMainWindow).toHaveBeenCalledOnce()
  })

  it('反复启停后可以重新创建迷你窗口', () => {
    setMiniPlayerEnabled(true, 360)
    const first = harness.instances[0]
    setMiniPlayerEnabled(false)
    setMiniPlayerEnabled(true, 360)

    expect(first.close).toHaveBeenCalledOnce()
    expect(harness.instances).toHaveLength(2)
    expect(harness.hideMainWindow).toHaveBeenCalledTimes(2)
  })
})
