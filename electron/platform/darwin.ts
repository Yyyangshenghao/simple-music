import type { PlatformAdapter, ShortcutResult } from './index'

// macOS / 其它平台：全部降级为空实现，仅记录日志。
export const darwinAdapter: PlatformAdapter = {
  startMousePoller() {
    console.info('[platform/darwin] 桌面歌词中键检测仅 Windows 支持，已跳过')
  },
  stopMousePoller() {},
  attachWallpaperToDesktop() {
    console.info('[platform/darwin] 壁纸桌面注入仅 Windows 支持，已跳过')
  },
  ensureDesktopShortcut(): ShortcutResult {
    return { ok: false, skipped: true }
  }
}
