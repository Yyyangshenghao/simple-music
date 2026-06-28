// IPC 类型契约：渲染层 ↔ 主进程。所有面向主窗口的通道都必须在此声明。
// overlay 窗口的内部通道（见底部 OverlayChannels/OverlayEvents）不属于主契约。

export interface DisplayBounds {
  x: number
  y: number
  width: number
  height: number
}

/** 主进程 getWindowState 的完整形态（渲染层 window store 取其子集）。 */
export interface WindowState {
  isMaximized: boolean
  isNativeFullScreen: boolean
  isHtmlFullScreen: boolean
  isWindowFullScreen: boolean
  isFullScreen: boolean
  isMinimized: boolean
  isVisible: boolean
  isFocused: boolean
  isPrimaryDisplay: boolean
  hasDisplayOnLeft: boolean
  hasDisplayOnRight: boolean
  displayBounds: DisplayBounds | null
}

export interface OkResult {
  ok: boolean
  error?: string
  canceled?: boolean
  message?: string
}

/** 登录窗口返回的 cookie 头（由渲染层转发给 server 的 /api/login/cookie）。 */
export interface LoginResult {
  ok: boolean
  cookie?: string
  reused?: boolean
  partial?: boolean
  cancelled?: boolean
  message?: string
  error?: string
}

/** 桌面歌词 payload：已知控制字段 + 渲染层自定义内容字段。 */
export interface LyricsPayload {
  enabled?: boolean
  y?: number
  opacity?: number
  clickThrough?: boolean
  [key: string]: unknown
}

/** 壁纸 payload：已知控制字段 + 视觉参数。 */
export interface WallpaperPayload {
  enabled?: boolean
  [key: string]: unknown
}

export interface HotkeyBinding {
  action: string
  accelerator: string
}

export interface HotkeyConflict {
  sourceName: string
  sourceIcon: string
  reason: string
}

export interface HotkeyOutcome {
  action: string
  accelerator: string
  ok: boolean
  conflict?: HotkeyConflict
}

export interface HotkeyResult {
  ok: boolean
  results: HotkeyOutcome[]
}

export interface ExportPayload {
  defaultName?: string
  text?: string
  data?: unknown
}

export interface FileResult {
  ok: boolean
  filePath?: string
  canceled?: boolean
  error?: string
}

export interface ImportResult {
  ok: boolean
  filePath?: string
  text?: string
  canceled?: boolean
  error?: string
}

// ---------- 主窗口契约 ----------
export interface IpcChannels {
  'window:minimize': { req: void; res: void }
  'window:toggle-fullscreen': { req: void; res: void }
  'window:exit-fullscreen-windowed': { req: void; res: void }
  'window:get-state': { req: void; res: WindowState }
  'window:close': { req: void; res: void }

  'login:netease-open': { req: void; res: LoginResult }
  'login:netease-clear': { req: void; res: OkResult }
  'login:qq-open': { req: void; res: LoginResult }
  'login:qq-clear': { req: void; res: OkResult }

  'lyrics:set-enabled': { req: { enabled: boolean; payload?: LyricsPayload }; res: OkResult }
  'lyrics:update': { req: LyricsPayload; res: OkResult }
  'lyrics:set-lock': { req: { locked: boolean }; res: OkResult }
  'lyrics:move-by': { req: { dx: number; dy: number }; res: OkResult }

  'wallpaper:set-enabled': { req: { enabled: boolean; payload?: WallpaperPayload }; res: OkResult }
  'wallpaper:update': { req: WallpaperPayload; res: OkResult }

  'hotkeys:configure': { req: HotkeyBinding[]; res: HotkeyResult }

  'file:export-json': { req: ExportPayload; res: FileResult }
  'file:import-json': { req: void; res: ImportResult }

  'app:restart': { req: void; res: OkResult }
  'app:open-update': { req: { filePath: string }; res: OkResult }
}

export interface IpcEvents {
  'window:state-changed': WindowState
  'lyrics:lock-state-changed': { locked: boolean }
  'lyrics:enabled-state-changed': { enabled: boolean }
  'hotkey:triggered': { action: string }
}

// ---------- overlay 窗口内部通道（不属于主契约） ----------
export interface HotBounds {
  left: number
  top: number
  right: number
  bottom: number
}

export interface OverlayChannels {
  'overlay:lyrics-set-dragging': { req: { dragging: boolean }; res: OkResult }
  'overlay:lyrics-set-pointer-capture': { req: { active: boolean }; res: OkResult }
  'overlay:lyrics-set-hot-bounds': { req: HotBounds; res: OkResult }
  'overlay:lyrics-set-lock': { req: { locked: boolean }; res: OkResult }
  'overlay:lyrics-move-by': { req: { dx: number; dy: number }; res: OkResult }
  'overlay:lyrics-close': { req: void; res: OkResult }
}

export interface OverlayEvents {
  'overlay:lyrics-state': LyricsPayload
  'overlay:wallpaper-state': WallpaperPayload
}
