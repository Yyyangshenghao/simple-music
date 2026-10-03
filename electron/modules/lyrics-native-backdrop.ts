import { createRequire } from 'node:module'
import type { BrowserWindow } from 'electron'
import { createWindowsLyricsBackdrop } from './windows-lyrics-backdrop'

const require = createRequire(import.meta.url)
let objc: ReturnType<typeof bindObjc> | undefined

function bindObjc() {
  const koffi = require('koffi') as typeof import('koffi')
  const lib = koffi.load('/usr/lib/libobjc.A.dylib')
  const rect = koffi.struct({
    origin: koffi.struct({ x: 'double', y: 'double' }),
    size: koffi.struct({ width: 'double', height: 'double' })
  })
  return {
    selector: lib.func('sel_registerName', 'void *', ['str']),
    class: lib.func('objc_getClass', 'void *', ['str']),
    object: lib.func('objc_msgSend', 'void *', ['void *', 'void *']),
    bool: lib.func('objc_msgSend', 'bool', ['void *', 'void *']),
    call: lib.func('objc_msgSend', 'void', ['void *', 'void *']),
    setBool: lib.func('objc_msgSend', 'void', ['void *', 'void *', 'bool']),
    setInteger: lib.func('objc_msgSend', 'void', ['void *', 'void *', 'long']),
    setDouble: lib.func('objc_msgSend', 'void', ['void *', 'void *', 'double']),
    initFrame: lib.func('objc_msgSend', 'void *', ['void *', 'void *', rect]),
    setFrame: lib.func('objc_msgSend', 'void', ['void *', 'void *', rect]),
    insert: lib.func('objc_msgSend', 'void', ['void *', 'void *', 'void *', 'long', 'void *'])
  }
}

/** 仅使用公开 AppKit API，在歌词内容后方添加局部毛玻璃，不改变窗口激活和输入行为。 */
export function createLyricsNativeBackdrop(win: BrowserWindow, onFailure?: () => void): {
  update(settings: { visible: boolean; opacity: number }): boolean
  dispose(): void
} | null {
  if (process.platform === 'win32') return createWindowsLyricsBackdrop(win, onFailure)
  if (process.platform !== 'darwin' || win.isDestroyed()) return null
  let view: unknown
  let api: ReturnType<typeof bindObjc> | undefined
  const dispose = () => {
    if (!view || !api) return
    const current = view
    view = undefined
    try {
      try {
        api.call(current, api.selector('removeFromSuperview'))
      } finally {
        api.call(current, api.selector('release'))
      }
    } catch (error) {
      console.warn('[desktop-lyrics] 无法移除 macOS 毛玻璃底框', error)
    }
  }
  try {
    const handle = win.getNativeWindowHandle()
    if (handle.length !== 8) throw new Error('Unexpected macOS window handle')
    const parent = handle.readBigUInt64LE()
    if (!parent) throw new Error('Missing macOS content view')
    api = objc ??= bindObjc()
    const native = api
    const flipped = native.bool(parent, native.selector('isFlipped'))
    const frame = () => {
      const zoom = win.webContents.getZoomFactor()
      const { width, height } = win.getBounds()
      return {
        origin: { x: 6 * zoom, y: (flipped ? 32 : 6) * zoom },
        size: { width: Math.max(0, width - 12 * zoom), height: Math.max(0, height - 38 * zoom) }
      }
    }
    const visualClass = native.class('NSVisualEffectView')
    if (!visualClass) throw new Error('Missing NSVisualEffectView')
    const allocated = native.object(visualClass, native.selector('alloc'))
    if (!allocated) throw new Error('Cannot allocate NSVisualEffectView')
    view = native.initFrame(allocated, native.selector('initWithFrame:'), frame())
    if (!view) throw new Error('Cannot initialize NSVisualEffectView')
    native.setInteger(view, native.selector('setBlendingMode:'), 0)
    native.setInteger(view, native.selector('setState:'), 1)
    native.setInteger(view, native.selector('setMaterial:'), 13)
    native.setBool(view, native.selector('setWantsLayer:'), true)
    const layer = native.object(view, native.selector('layer'))
    if (!layer) throw new Error('Missing visual effect layer')
    native.setDouble(layer, native.selector('setCornerRadius:'), 10 * win.webContents.getZoomFactor())
    native.setBool(layer, native.selector('setMasksToBounds:'), true)
    native.setBool(view, native.selector('setHidden:'), true)
    // NSWindowBelow (-1) + nil 插到所有现有子视图下方，保留网页的命中测试和拖动。
    native.insert(parent, native.selector('addSubview:positioned:relativeTo:'), view, -1, null)
    return {
      update({ visible, opacity }) {
        if (!view) return false
        try {
          if (win.isDestroyed()) {
            dispose()
            return false
          }
          native.setFrame(view, native.selector('setFrame:'), frame())
          native.setDouble(layer, native.selector('setCornerRadius:'), 10 * win.webContents.getZoomFactor())
          native.setDouble(view, native.selector('setAlphaValue:'), Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : 0)
          native.setBool(view, native.selector('setHidden:'), !visible)
          return true
        } catch (error) {
          console.warn('[desktop-lyrics] 无法更新 macOS 毛玻璃底框', error)
          dispose()
          return false
        }
      },
      dispose
    }
  } catch (error) {
    console.warn('[desktop-lyrics] 无法创建 macOS 毛玻璃底框', error)
    dispose()
    return null
  }
}
