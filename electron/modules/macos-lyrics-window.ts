import { createRequire } from 'node:module'
import type { BrowserWindow } from 'electron'

const require = createRequire(import.meta.url)
let objc: ReturnType<typeof bindObjc> | undefined

function bindObjc() {
  const koffi = require('koffi') as typeof import('koffi')
  const lib = koffi.load('/usr/lib/libobjc.A.dylib')
  return {
    selector: lib.func('sel_registerName', 'void *', ['str']),
    object: lib.func('objc_msgSend', 'void *', ['void *', 'void *']),
    responds: lib.func('objc_msgSend', 'bool', ['void *', 'void *', 'void *']),
    setBool: lib.func('objc_msgSend', 'void', ['void *', 'void *', 'bool'])
  }
}

/** 仅在 Electron 主线程创建歌词窗后同步调用，不持有原生窗口指针。 */
export function preventLyricsActivation(win: BrowserWindow): boolean {
  if (process.platform !== 'darwin') return true
  try {
    if (win.isDestroyed()) return false
    const handle = win.getNativeWindowHandle()
    if (handle.length !== 8) throw new Error('Unexpected macOS window handle')
    const view = handle.readBigUInt64LE()
    if (!view) throw new Error('Missing macOS content view')
    objc ??= bindObjc()
    // macOS 的 Electron handle 是 NSView*，不是 NSWindow*。
    const nativeWindow = objc.object(view, objc.selector('window'))
    if (!nativeWindow) throw new Error('Missing macOS lyrics window')
    const setter = objc.selector('_setPreventsActivation:')
    const responds = objc.selector('respondsToSelector:')
    if (!objc.responds(nativeWindow, responds, setter)) {
      throw new Error('macOS window does not support preventing activation')
    }
    // macOS 27 的 panel 仍会激活应用；需同步设置 AppKit 的原生窗口标记。
    // https://github.com/electron/electron/issues/53889
    objc.setBool(nativeWindow, setter, true)
    return true
  } catch (error) {
    console.warn('[desktop-lyrics] 无法启用 macOS 非激活交互', error)
    return false
  }
}
