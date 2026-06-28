export interface ShortcutResult {
  ok: boolean
  skipped?: boolean
  created?: boolean
  existing?: boolean
  path?: string
  error?: string
}

/** 平台相关能力的统一接口。win32 完整实现，darwin/其它降级。 */
export interface PlatformAdapter {
  /** 全局监听鼠标中键（桌面歌词锁定切换）。仅 Windows 有效。 */
  startMousePoller(onMiddleClick: () => void): void
  stopMousePoller(): void
  /** 把壁纸窗口注入桌面层（WorkerW）。参数为窗口原生句柄十进制字符串。 */
  attachWallpaperToDesktop(hwnd: string): void
  /** 创建桌面快捷方式（.lnk）。 */
  ensureDesktopShortcut(): ShortcutResult
}

import { win32Adapter } from './win32'
import { darwinAdapter } from './darwin'

export function getPlatform(): PlatformAdapter {
  return process.platform === 'win32' ? win32Adapter : darwinAdapter
}
