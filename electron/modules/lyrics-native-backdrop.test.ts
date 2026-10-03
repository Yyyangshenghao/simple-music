import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'

const native = vi.hoisted(() => ({
  calls: vi.fn(),
  flipped: false,
  load: vi.fn(),
  require: vi.fn()
}))

vi.mock('node:module', () => ({ createRequire: () => native.require }))

function windowWithHandle() {
  const handle = Buffer.alloc(8)
  handle.writeBigUInt64LE(100n)
  return {
    isDestroyed: vi.fn(() => false),
    getNativeWindowHandle: vi.fn(() => handle),
    getBounds: vi.fn(() => ({ width: 600, height: 120 })),
    webContents: { getZoomFactor: vi.fn(() => 1) }
  }
}

describe('歌词局部原生毛玻璃', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    native.flipped = false
    vi.stubGlobal('process', Object.create(process, { platform: { value: 'darwin' } }))
    native.load.mockReturnValue({ func: (name: string, result: string) => {
      if (name === 'sel_registerName') return (selector: string) => selector
      if (name === 'objc_getClass') return () => 200n
      return (...args: unknown[]) => {
        native.calls(...args)
        if (result === 'bool') return native.flipped
        if (result === 'void *') return args[1] === 'layer' ? 400n : 300n
      }
    } })
    native.require.mockReturnValue({ load: native.load, struct: (members: unknown) => members })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('在网页子视图下方创建底框，避开顶部控制区且不调用激活方法', async () => {
    const { createLyricsNativeBackdrop } = await import('./lyrics-native-backdrop')
    const backdrop = createLyricsNativeBackdrop(windowWithHandle() as unknown as BrowserWindow)
    expect(backdrop).not.toBeNull()
    expect(native.calls).toHaveBeenCalledWith(300n, 'initWithFrame:', {
      origin: { x: 6, y: 6 }, size: { width: 588, height: 82 }
    })
    expect(native.calls).toHaveBeenCalledWith(100n, 'addSubview:positioned:relativeTo:', 300n, -1, null)
    expect(native.calls).toHaveBeenCalledWith(300n, 'setBlendingMode:', 0)
    expect(native.calls).toHaveBeenCalledWith(300n, 'setState:', 1)
    expect(native.calls).toHaveBeenCalledWith(300n, 'setMaterial:', 13)
    expect(native.calls).toHaveBeenCalledWith(400n, 'setCornerRadius:', 10)
    expect(native.calls).toHaveBeenCalledWith(300n, 'setHidden:', true)
    expect(native.calls.mock.calls.some(([, selector]) => /makeKey|activate|PreventsActivation/.test(String(selector)))).toBe(false)
  })

  it('缩放和窗口尺寸变化后重算底框，flipped 原点从顶部控制区之后开始', async () => {
    native.flipped = true
    const { createLyricsNativeBackdrop } = await import('./lyrics-native-backdrop')
    const win = windowWithHandle()
    const backdrop = createLyricsNativeBackdrop(win as unknown as BrowserWindow)!
    win.webContents.getZoomFactor.mockReturnValue(1.5)
    win.getBounds.mockReturnValue({ width: 900, height: 180 })
    expect(backdrop.update({ visible: true, opacity: 0.45 })).toBe(true)
    expect(native.calls).toHaveBeenCalledWith(300n, 'setFrame:', {
      origin: { x: 9, y: 48 }, size: { width: 882, height: 123 }
    })
    expect(native.calls).toHaveBeenCalledWith(400n, 'setCornerRadius:', 15)
    expect(native.calls).toHaveBeenCalledWith(300n, 'setAlphaValue:', 0.45)
    expect(native.calls).toHaveBeenLastCalledWith(300n, 'setHidden:', false)
  })

  it('锁定隐藏底框，dispose 只移除和释放一次，之后更新无效', async () => {
    const { createLyricsNativeBackdrop } = await import('./lyrics-native-backdrop')
    const backdrop = createLyricsNativeBackdrop(windowWithHandle() as unknown as BrowserWindow)!
    backdrop.update({ visible: false, opacity: 2 })
    expect(native.calls).toHaveBeenCalledWith(300n, 'setAlphaValue:', 1)
    expect(native.calls).toHaveBeenLastCalledWith(300n, 'setHidden:', true)
    backdrop.dispose()
    expect(native.calls).toHaveBeenLastCalledWith(300n, 'release')
    const count = native.calls.mock.calls.length
    backdrop.dispose()
    expect(backdrop.update({ visible: true, opacity: 0.5 })).toBe(false)
    expect(native.calls.mock.calls).toHaveLength(count)
    expect(native.calls).toHaveBeenCalledWith(300n, 'removeFromSuperview')
  })

  it('非 macOS 不加载依赖或访问窗口句柄', async () => {
    vi.stubGlobal('process', Object.create(process, { platform: { value: 'win32' } }))
    const { createLyricsNativeBackdrop } = await import('./lyrics-native-backdrop')
    const win = windowWithHandle()
    expect(createLyricsNativeBackdrop(win as unknown as BrowserWindow)).toBeNull()
    expect(native.require).not.toHaveBeenCalled()
    expect(win.getNativeWindowHandle).not.toHaveBeenCalled()
  })

  it('更新失败返回 false，清理底框供调用者回退 CSS 效果', async () => {
    const { createLyricsNativeBackdrop } = await import('./lyrics-native-backdrop')
    const backdrop = createLyricsNativeBackdrop(windowWithHandle() as unknown as BrowserWindow)!
    native.calls.mockImplementation((_, selector) => {
      if (selector === 'setFrame:') throw new Error('Update failure')
    })
    expect(backdrop.update({ visible: true, opacity: 0.5 })).toBe(false)
    expect(native.calls).toHaveBeenLastCalledWith(300n, 'release')
    expect(backdrop.update({ visible: true, opacity: 0.5 })).toBe(false)
  })

  it('原生初始化失败后释放已创建对象，不阻塞歌词窗口', async () => {
    native.calls.mockImplementation((_, selector) => {
      if (selector === 'setMaterial:') throw new Error('Native failure')
    })
    const { createLyricsNativeBackdrop } = await import('./lyrics-native-backdrop')
    expect(createLyricsNativeBackdrop(windowWithHandle() as unknown as BrowserWindow)).toBeNull()
    expect(native.calls).toHaveBeenCalledWith(300n, 'removeFromSuperview')
    expect(native.calls).toHaveBeenLastCalledWith(300n, 'release')
    expect(console.warn).toHaveBeenCalled()
  })
})
