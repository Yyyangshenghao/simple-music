import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'

const native = vi.hoisted(() => ({
  object: vi.fn(() => 200n),
  responds: vi.fn(() => true),
  setBool: vi.fn(),
  load: vi.fn(),
  require: vi.fn()
}))

vi.mock('node:module', () => ({ createRequire: () => native.require }))

function windowWithHandle(address = 100n) {
  const handle = Buffer.alloc(8)
  handle.writeBigUInt64LE(address)
  return { isDestroyed: () => false, getNativeWindowHandle: vi.fn(() => handle) } as unknown as BrowserWindow
}

describe('macOS 歌词非激活交互', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.stubGlobal('process', Object.create(process, { platform: { value: 'darwin' } }))
    native.object.mockReturnValue(200n)
    native.responds.mockReturnValue(true)
    native.load.mockReturnValue({ func: (name: string, result: string) => {
      if (name === 'sel_registerName') return (selector: string) => selector
      if (result === 'void *') return native.object
      if (result === 'void') return native.setBool
      return native.responds
    } })
    native.require.mockReturnValue({ load: native.load })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('从 NSView 取所属窗口，只为该窗口设置 AppKit 非激活标记', async () => {
    const { preventLyricsActivation } = await import('./macos-lyrics-window')
    expect(preventLyricsActivation(windowWithHandle())).toBe(true)
    expect(native.object).toHaveBeenCalledWith(100n, 'window')
    expect(native.setBool).toHaveBeenCalledWith(200n, '_setPreventsActivation:', true)
  })

  it('系统或 Electron 不支持时不发送未知方法，明确报告失败', async () => {
    native.responds.mockReturnValue(false)
    const { preventLyricsActivation } = await import('./macos-lyrics-window')
    expect(preventLyricsActivation(windowWithHandle())).toBe(false)
    expect(native.setBool).not.toHaveBeenCalled()
    expect(console.warn).toHaveBeenCalled()
  })

  it('空句柄不进入原生调用', async () => {
    const { preventLyricsActivation } = await import('./macos-lyrics-window')
    expect(preventLyricsActivation(windowWithHandle(0n))).toBe(false)
    expect(native.load).not.toHaveBeenCalled()
  })

  it('原生依赖加载失败时报告失败', async () => {
    native.require.mockImplementationOnce(() => { throw new Error('Missing native dependency') })
    const { preventLyricsActivation } = await import('./macos-lyrics-window')
    expect(preventLyricsActivation(windowWithHandle())).toBe(false)
    expect(console.warn).toHaveBeenCalled()
  })

  it('Windows 不加载原生依赖或访问 macOS 句柄', async () => {
    vi.stubGlobal('process', Object.create(process, { platform: { value: 'win32' } }))
    const { preventLyricsActivation } = await import('./macos-lyrics-window')
    const win = windowWithHandle()
    expect(preventLyricsActivation(win)).toBe(true)
    expect(native.require).not.toHaveBeenCalled()
    expect(win.getNativeWindowHandle).not.toHaveBeenCalled()
  })
})
