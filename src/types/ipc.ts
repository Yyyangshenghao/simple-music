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

/** 迷你播放条外观：全部由主窗口设置页调节，随 payload 下发给 overlay。 */
export interface MiniPlayerAppearance {
  /** 底板不透明度 0.15–1。 */
  opacity: number
  /** 背景模糊半径 px，0–36。 */
  blur: number
  /** 色调：深色 / 浅色 / 跟随封面主色。 */
  tint: 'dark' | 'light' | 'cover'
  /** 底边细进度条。 */
  showProgress: boolean
  /** 展开态（宽度足够时）显示当前歌词行。 */
  showLyrics: boolean
}

/** 迷你播放条 payload：当前曲目展示字段（enable/disable 走独立通道，不混进这里）。 */
export interface MiniPlayerPayload {
  trackTitle?: string
  artistName?: string
  coverUrl?: string
  playing?: boolean
  /** 当前播放进度（秒）。 */
  position?: number
  /** 曲目总时长（秒）。 */
  duration?: number
  /** 音量 0–1。 */
  volume?: number
  /** 当前歌词行，无歌词为空串。 */
  lyricLine?: string
  /** 封面主色 hex，tint='cover' 时用作底色。 */
  accent?: string
  appearance?: MiniPlayerAppearance
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

  'miniplayer:set-enabled': { req: { enabled: boolean; width?: number }; res: OkResult }
  'miniplayer:update': { req: MiniPlayerPayload; res: OkResult }

  'hotkeys:configure': { req: HotkeyBinding[]; res: HotkeyResult }

  'file:export-json': { req: ExportPayload; res: FileResult }
  'file:import-json': { req: void; res: ImportResult }
  'file:select-directory': { req: { title?: string; defaultPath?: string }; res: FileResult }

  'app:restart': { req: void; res: OkResult }
  'app:install-update': { req: { filePath: string }; res: OkResult }
}

export interface IpcEvents {
  'window:state-changed': WindowState
  'lyrics:lock-state-changed': { locked: boolean }
  'lyrics:enabled-state-changed': { enabled: boolean }
  'hotkey:triggered': { action: string }
  'miniplayer:control': { action: string; value?: number }
  /** overlay 侧拖拽改宽后回传，主窗口负责持久化。 */
  'miniplayer:width-changed': { width: number }
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
  'overlay:miniplayer-move-by': { req: { dx: number; dy: number }; res: OkResult }
  'overlay:miniplayer-resize-by': { req: { dx: number }; res: OkResult }
  'overlay:miniplayer-set-popover': { req: { open: boolean }; res: OkResult }
  'overlay:miniplayer-control': { req: { action: string; value?: number }; res: OkResult }
  'overlay:miniplayer-close': { req: void; res: OkResult }
  'overlay:miniplayer-focus-main': { req: void; res: OkResult }
}

export interface OverlayEvents {
  'overlay:lyrics-state': LyricsPayload
  'overlay:wallpaper-state': WallpaperPayload
  'overlay:miniplayer-state': MiniPlayerPayload
}
