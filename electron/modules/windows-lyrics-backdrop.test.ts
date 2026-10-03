import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'

const h = vi.hoisted(() => ({
  require: vi.fn(), calls: {} as Record<string, ReturnType<typeof vi.fn>>,
  callback: undefined as undefined | ((hwnd: bigint, message: number, wparam: number, lparam: number) => number),
  scale: 1, build: '10.0.19045'
}))
vi.mock('node:module', () => ({ createRequire: () => h.require }))
vi.mock('node:os', () => ({ release: () => h.build }))
vi.mock('electron', () => ({ screen: { getDisplayMatching: () => ({ scaleFactor: h.scale }) } }))

function windowFixture() {
  const handle = Buffer.alloc(8)
  handle.writeBigUInt64LE(100n)
  const listeners = new Map<string, () => void>()
  return {
    isDestroyed: vi.fn(() => false), isVisible: vi.fn(() => true), isMinimized: vi.fn(() => false),
    getNativeWindowHandle: () => handle, getBounds: () => ({ x: 100, y: 200, width: 600, height: 120 }),
    webContents: { getZoomFactor: vi.fn(() => 1) }, listeners,
    on: vi.fn((event: string, callback: () => void) => { listeners.set(event, callback) }),
    removeListener: vi.fn((event: string) => { listeners.delete(event) })
  }
}

describe('Windows 桌面歌词原生毛玻璃', () => {
  beforeEach(() => {
    vi.resetModules()
    h.calls = {}
    h.scale = 1
    h.build = '10.0.19045'
    vi.stubGlobal('process', Object.create(process, { platform: { value: 'win32' } }))
    h.require.mockReset().mockReturnValue({
      load: () => ({ func: (_convention: string, name: string) => h.calls[name] ??= vi.fn(() => 1) }),
      struct: (members: unknown) => members, pointer: (type: unknown) => type, out: (type: unknown) => type,
      inout: (type: unknown) => type, proto: vi.fn(), sizeof: () => 16,
      register: (callback: typeof h.callback) => { h.callback = callback; return 123 }, unregister: vi.fn()
    })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  async function create(onFailure?: () => void) {
    const { createWindowsLyricsBackdrop } = await import('./windows-lyrics-backdrop')
    const win = windowFixture()
    const backdrop = createWindowsLyricsBackdrop(win as unknown as BrowserWindow, onFailure)
    h.calls.GetClientRect.mockImplementation((_hwnd, rect) => { Object.assign(rect, { right: 600, bottom: 120 }); return 1 })
    h.calls.ClientToScreen.mockImplementation((_hwnd, point) => { point.x += 100; point.y += 200; return 1 })
    return { win, backdrop: backdrop! }
  }

  it('在歌词下面创建无激活、无任务栏底框，并使用 Acrylic', async () => {
    const { backdrop } = await create()
    expect(backdrop.update({ visible: true, opacity: 0.68 })).toBe(true)
    expect(h.calls.CreateWindowExW).toHaveBeenCalledWith(0x080800a0, 'SimpleMusicLyricsBackdrop', '', 0x80000000, 0, 0, 1, 1, 0, 0, 1, null)
    expect(h.calls.SetLayeredWindowAttributes).toHaveBeenLastCalledWith(1, 0, 173, 2)
    expect(h.calls.SetWindowCompositionAttribute).toHaveBeenCalledWith(1, {
      attribute: 19, data: { state: 4, flags: 0, color: 0xad1d1612, animation: 0 }, size: 16
    })
    expect(h.calls.SetWindowPos).toHaveBeenLastCalledWith(1, 100n, 106, 232, 588, 82, 0x50)
    expect(h.callback!(1n, 0x84, 0, 0)).toBe(-1)
    expect(h.callback!(1n, 0x21, 0, 0)).toBe(3)
  })

  it('不透明度控制整个毛玻璃底框，重复值不重新设置，0% 后恢复使用新值', async () => {
    const { backdrop } = await create()
    for (const opacity of [0.1, 0.5, 1]) {
      expect(backdrop.update({ visible: true, opacity })).toBe(true)
      expect(h.calls.SetLayeredWindowAttributes).toHaveBeenLastCalledWith(1, 0, Math.round(opacity * 255), 2)
    }
    const calls = h.calls.SetLayeredWindowAttributes.mock.calls.length
    backdrop.update({ visible: true, opacity: 1 })
    expect(h.calls.SetLayeredWindowAttributes).toHaveBeenCalledTimes(calls)
    backdrop.update({ visible: true, opacity: 0 })
    expect(h.calls.ShowWindow).toHaveBeenLastCalledWith(1, 0)
    backdrop.update({ visible: true, opacity: 0.2 })
    expect(h.calls.SetLayeredWindowAttributes).toHaveBeenLastCalledWith(1, 0, 51, 2)
    expect(h.calls.SetWindowCompositionAttribute).toHaveBeenCalledOnce()
  })

  it('显示器 DPI 和页面缩放均计入实际客户区，不修改歌词窗口尺寸', async () => {
    const { win, backdrop } = await create()
    h.scale = 1.25
    win.webContents.getZoomFactor.mockReturnValue(1.2)
    h.calls.GetClientRect.mockImplementation((_hwnd, rect) => { Object.assign(rect, { right: 900, bottom: 180 }); return 1 })
    backdrop.update({ visible: true, opacity: 0.5 })
    expect(h.calls.SetWindowPos).toHaveBeenLastCalledWith(1, 100n, 109, 248, 882, 123, 0x50)
    expect(h.calls.CreateRoundRectRgn).toHaveBeenCalledWith(0, 0, 883, 124, 30, 30)
    expect(h.calls.DeleteObject).not.toHaveBeenCalled()
  })

  it('关闭效果、0% 透明度、隐藏窗口与最小化均隐藏底框，恢复后重新显示', async () => {
    const { win, backdrop } = await create()
    for (const settings of [{ visible: false, opacity: 0.68 }, { visible: true, opacity: 0 }]) {
      expect(backdrop.update(settings)).toBe(true)
      expect(h.calls.ShowWindow).toHaveBeenLastCalledWith(1, 0)
    }
    win.isVisible.mockReturnValue(false)
    backdrop.update({ visible: true, opacity: 0.68 })
    expect(h.calls.SetWindowPos).not.toHaveBeenCalled()
    win.isVisible.mockReturnValue(true)
    win.listeners.get('show')!()
    expect(h.calls.SetWindowPos).toHaveBeenCalledOnce()
    win.listeners.get('minimize')!()
    expect(h.calls.ShowWindow).toHaveBeenLastCalledWith(1, 0)
    win.listeners.get('restore')!()
    expect(h.calls.SetWindowPos).toHaveBeenCalledTimes(2)
  })

  it('重复 dispose 只销毁一次，移除监听器，后续更新失败', async () => {
    const { win, backdrop } = await create()
    backdrop.dispose()
    backdrop.dispose()
    expect(h.calls.DestroyWindow).toHaveBeenCalledOnce()
    expect(win.listeners.size).toBe(0)
    expect(backdrop.update({ visible: true, opacity: 0.5 })).toBe(false)
  })

  it.each(['SetLayeredWindowAttributes', 'SetWindowPos', 'GetClientRect', 'SetWindowRgn'])('%s 失败释放窗口并通知调用方回退，失败区域由调用方释放', async (method) => {
    const { backdrop } = await create()
    h.calls[method].mockReturnValue(0)
    expect(backdrop.update({ visible: true, opacity: 0.5 })).toBe(false)
    expect(h.calls.DestroyWindow).toHaveBeenCalledOnce()
    expect(h.calls.DeleteObject).toHaveBeenCalledTimes(method === 'SetWindowRgn' ? 1 : 0)
  })

  it.each(['DwmExtendFrameIntoClientArea', 'SetWindowCompositionAttribute'])('%s 初始化失败释放已创建窗口', async (method) => {
    // 先绑定函数，再在下一个实例创建时模拟初始化失败。
    const { backdrop } = await create()
    backdrop.dispose()
    h.calls[method].mockReturnValue(method === 'DwmExtendFrameIntoClientArea' ? -1 : 0)
    const { createWindowsLyricsBackdrop } = await import('./windows-lyrics-backdrop')
    expect(createWindowsLyricsBackdrop(windowFixture() as unknown as BrowserWindow)).toBeNull()
    expect(h.calls.DestroyWindow).toHaveBeenCalledTimes(2)
  })

  it('窗口恢复失败通知管理器立即回退，而不等待下次歌词更新', async () => {
    const onFailure = vi.fn()
    const { win, backdrop } = await create(onFailure)
    backdrop.update({ visible: true, opacity: 0.68 })
    h.calls.SetWindowPos.mockReturnValue(0)
    win.listeners.get('restore')!()
    expect(onFailure).toHaveBeenCalledOnce()
    expect(h.calls.DestroyWindow).toHaveBeenCalledOnce()
    expect(win.listeners.size).toBe(0)
  })

  it('旧版 Windows 不加载原生依赖', async () => {
    h.build = '10.0.16299'
    const { createWindowsLyricsBackdrop } = await import('./windows-lyrics-backdrop')
    expect(createWindowsLyricsBackdrop(windowFixture() as unknown as BrowserWindow)).toBeNull()
    expect(h.require).not.toHaveBeenCalled()
  })
})
