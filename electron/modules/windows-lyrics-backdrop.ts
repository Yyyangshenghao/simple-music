import { createRequire } from 'node:module'
import { release } from 'node:os'
import { screen, type BrowserWindow } from 'electron'

const require = createRequire(import.meta.url)
let native: ReturnType<typeof bindWindowsBackdrop> | undefined

function bindWindowsBackdrop() {
  const koffi = require('koffi') as typeof import('koffi')
  const user = koffi.load('user32.dll')
  const gdi = koffi.load('gdi32.dll')
  const dwm = koffi.load('dwmapi.dll')
  const kernel = koffi.load('kernel32.dll')
  const point = koffi.struct({ x: 'int', y: 'int' })
  const rect = koffi.struct({ left: 'int', top: 'int', right: 'int', bottom: 'int' })
  const margins = koffi.struct({ left: 'int', right: 'int', top: 'int', bottom: 'int' })
  const accent = koffi.struct({ state: 'int', flags: 'int', color: 'uint32', animation: 'int' })
  const composition = koffi.struct({ attribute: 'int', data: koffi.pointer(accent), size: 'size_t' })
  const procedure = koffi.proto('__stdcall', 'intptr_t', ['uintptr_t', 'uint', 'uintptr_t', 'intptr_t'])
  const windowClass = koffi.struct({
    size: 'uint', style: 'uint', procedure: koffi.pointer(procedure), classExtra: 'int', windowExtra: 'int',
    instance: 'uintptr_t', icon: 'uintptr_t', cursor: 'uintptr_t', background: 'uintptr_t',
    menu: 'str16', name: 'str16', smallIcon: 'uintptr_t'
  })
  const defWindowProc = user.func('__stdcall', 'DefWindowProcW', 'intptr_t', ['uintptr_t', 'uint', 'uintptr_t', 'intptr_t'])
  // 不接收输入、不激活应用，不绘制不透明背景；DWM 绘制底框。
  const callback = koffi.register((hwnd: number | bigint, message: number, wparam: number | bigint, lparam: number | bigint) => {
    if (message === 0x84) return -1 // WM_NCHITTEST: HTTRANSPARENT
    if (message === 0x21) return 3 // WM_MOUSEACTIVATE: MA_NOACTIVATE
    if (message === 0x14) return 1 // WM_ERASEBKGND
    return defWindowProc(hwnd, message, wparam, lparam)
  }, koffi.pointer(procedure))
  const instance = kernel.func('__stdcall', 'GetModuleHandleW', 'uintptr_t', ['str16'])(null)
  try {
    const api = {
      // 保留回调和 DLL 绑定至进程退出，窗口销毁后仍可重新创建同一原生类。
      callback,
      create: user.func('__stdcall', 'CreateWindowExW', 'uintptr_t', ['uint', 'str16', 'str16', 'uint', 'int', 'int', 'int', 'int', 'uintptr_t', 'uintptr_t', 'uintptr_t', 'void *']),
      destroy: user.func('__stdcall', 'DestroyWindow', 'int', ['uintptr_t']),
      show: user.func('__stdcall', 'ShowWindow', 'int', ['uintptr_t', 'int']),
      layered: user.func('__stdcall', 'SetLayeredWindowAttributes', 'int', ['uintptr_t', 'uint32', 'uint8', 'uint']),
      position: user.func('__stdcall', 'SetWindowPos', 'int', ['uintptr_t', 'uintptr_t', 'int', 'int', 'int', 'int', 'uint']),
      clientRect: user.func('__stdcall', 'GetClientRect', 'int', ['uintptr_t', koffi.out(koffi.pointer(rect))]),
      clientToScreen: user.func('__stdcall', 'ClientToScreen', 'int', ['uintptr_t', koffi.inout(koffi.pointer(point))]),
      region: gdi.func('__stdcall', 'CreateRoundRectRgn', 'uintptr_t', ['int', 'int', 'int', 'int', 'int', 'int']),
      setRegion: user.func('__stdcall', 'SetWindowRgn', 'int', ['uintptr_t', 'uintptr_t', 'int']),
      deleteRegion: gdi.func('__stdcall', 'DeleteObject', 'int', ['uintptr_t']),
      extend: dwm.func('__stdcall', 'DwmExtendFrameIntoClientArea', 'int32', ['uintptr_t', koffi.pointer(margins)]),
      composition: user.func('__stdcall', 'SetWindowCompositionAttribute', 'int', ['uintptr_t', koffi.pointer(composition)]),
      accentSize: koffi.sizeof(accent),
      instance
    }
    const register = user.func('__stdcall', 'RegisterClassExW', 'uint16', [koffi.pointer(windowClass)])
    if (!register({ size: koffi.sizeof(windowClass), style: 0, procedure: callback, classExtra: 0, windowExtra: 0,
      instance, icon: 0, cursor: 0, background: 0, menu: null, name: 'SimpleMusicLyricsBackdrop', smallIcon: 0 })) {
      throw new Error('Cannot register lyrics backdrop class')
    }
    return api
  } catch (error) {
    koffi.unregister(callback)
    throw error
  }
}

/** 独立原生底框，无额外渲染进程；始终放在透明歌词窗下方，保留顶部解锁留白。 */
export function createWindowsLyricsBackdrop(win: BrowserWindow, onFailure?: () => void) {
  if (process.platform !== 'win32' || Number(release().split('.')[2]) < 17134 || win.isDestroyed()) return null
  let hwnd: number | bigint = 0
  let api: ReturnType<typeof bindWindowsBackdrop> | undefined
  let settings = { visible: false, opacity: 0.68 }
  let previousShape = ''
  let previousAlpha = 255
  const dispose = () => {
    win.removeListener('show', refresh)
    win.removeListener('hide', hide)
    win.removeListener('minimize', hide)
    win.removeListener('restore', refresh)
    win.removeListener('closed', dispose)
    if (!hwnd || !api) return
    const current = hwnd
    hwnd = 0
    api.destroy(current)
  }
  const hide = () => { if (hwnd && api) api.show(hwnd, 0) }
  const refresh = () => { if (!update(settings)) onFailure?.() }
  const update = (next: typeof settings): boolean => {
    settings = next
    if (!hwnd || !api) return false
    try {
      if (win.isDestroyed()) { dispose(); return false }
      const opacity = Number.isFinite(next.opacity) ? Math.min(1, Math.max(0, next.opacity)) : 0
      if (!next.visible || opacity === 0 || !win.isVisible() || win.isMinimized()) { hide(); return true }
      const handle = win.getNativeWindowHandle()
      const lyrics = handle.length === 8 ? handle.readBigUInt64LE() : handle.readUInt32LE()
      const scale = screen.getDisplayMatching(win.getBounds()).scaleFactor * win.webContents.getZoomFactor()
      const client = { left: 0, top: 0, right: 0, bottom: 0 }
      const origin = { x: Math.round(6 * scale), y: Math.round(32 * scale) }
      if (!api.clientRect(lyrics, client) || !api.clientToScreen(lyrics, origin)) throw new Error('Cannot locate lyrics client area')
      const width = Math.max(1, client.right - client.left - Math.round(12 * scale))
      const height = Math.max(1, client.bottom - client.top - Math.round(38 * scale))
      const radius = Math.round(20 * scale)
      const shape = `${width},${height},${radius}`
      if (shape !== previousShape) {
        const region = api.region(0, 0, width + 1, height + 1, radius, radius)
        if (!region) throw new Error('Cannot create backdrop region')
        if (!api.setRegion(hwnd, region, 1)) {
          api.deleteRegion(region)
          throw new Error('Cannot clip backdrop region')
        }
        // SetWindowRgn 成功后由系统拥有 HRGN，不可再次释放。
        previousShape = shape
      }
      // 淡化整个毛玻璃合成结果，避免低不透明度时仍保留完整模糊。
      const alpha = Math.round(opacity * 255)
      if (alpha !== previousAlpha) {
        if (!api.layered(hwnd, 0, alpha, 2)) throw new Error('Cannot set Windows backdrop opacity')
        previousAlpha = alpha
      }
      // hWndInsertAfter=歌词 HWND，底框位于歌词下方；SWP_NOACTIVATE | SWP_SHOWWINDOW。
      if (!api.position(hwnd, lyrics, origin.x, origin.y, width, height, 0x10 | 0x40)) throw new Error('Cannot position backdrop')
      return true
    } catch (error) {
      console.warn('[desktop-lyrics] 无法更新 Windows 毛玻璃底框', error)
      dispose()
      return false
    }
  }
  try {
    api = native ??= bindWindowsBackdrop()
    // layered + transparent 才保证跨线程鼠标穿透；无 owner，避免被置于歌词上方。
    // WS_EX_NOACTIVATE | WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW。
    hwnd = api.create(0x08000000 | 0x80000 | 0x20 | 0x80, 'SimpleMusicLyricsBackdrop', '', 0x80000000, 0, 0, 1, 1, 0, 0, api.instance, null)
    if (!hwnd) throw new Error('Cannot create Windows backdrop')
    // 初始化输入穿透层；首次显示时按用户设置更新全窗 alpha。
    if (!api.layered(hwnd, 0, 255, 2)) throw new Error('Cannot configure transparent input layer')
    if (api.extend(hwnd, { left: -1, right: -1, top: -1, bottom: -1 }) < 0) throw new Error('Cannot extend Windows glass frame')
    // 创建时就验证合成接口，窗口尚未显示也能可靠决定是否回退暗灰底框。
    // 染色固定为默认深色；滑块独立控制底框整体不透明度。
    if (!api.composition(hwnd, { attribute: 19, data: { state: 4, flags: 0, color: 0xad1d1612, animation: 0 }, size: api.accentSize })) {
      throw new Error('Cannot initialize Windows acrylic backdrop')
    }
    win.on('show', refresh)
    win.on('hide', hide)
    win.on('minimize', hide)
    win.on('restore', refresh)
    win.on('closed', dispose)
    return { update, dispose }
  } catch (error) {
    console.warn('[desktop-lyrics] 无法创建 Windows 毛玻璃底框', error)
    dispose()
    return null
  }
}
