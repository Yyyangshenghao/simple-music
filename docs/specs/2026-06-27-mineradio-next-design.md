# Mineradio-Next 设计文档

**日期：** 2026-06-27  
**状态：** 已确认，待实现  
**参考项目：** `/Users/yangshenghao/github/Mineradio`

---

## 1. 背景与目标

现有 Mineradio 项目（v1.1.0）是一个 Electron + 原生 HTML/CSS/JS 的沉浸式音乐播放器，功能完整但存在以下问题：

- `desktop/main.js` 是 1471 行巨石文件，窗口管理、IPC、平台特定代码全部混在一起
- `public/index.html` 是单文件前端，所有 UI、CSS、视觉预设、播放逻辑耦合
- 仅支持 Windows（壁纸/桌面歌词鼠标检测依赖 PowerShell/Win32 API）
- 无类型系统，维护和扩展成本高

**目标：** 在新目录 `Mineradio-Next/` 完整重写，功能与现有项目高度一致，同时：

- 支持 macOS（优先）和 Windows
- 模块化架构，低耦合
- TypeScript 全栈
- 使用 React 18 + electron-vite 现代工具链

---

## 2. 技术选型

| 层次 | 技术 |
|------|------|
| Electron 主进程 | TypeScript + 模块化 |
| 渲染层框架 | React 18 + TypeScript |
| 构建工具 | electron-vite + Vite |
| Three.js 集成 | @react-three/fiber + @react-three/drei |
| 状态管理 | Zustand |
| 样式 | CSS Modules |
| 打包 | electron-builder |
| 音乐 API | NeteaseCloudMusicApi（Node.js，复用） |

---

## 3. 整体目录结构

```
Mineradio-Next/
├── electron/                    # 主进程（TypeScript）
│   ├── main.ts
│   ├── modules/
│   │   ├── window-manager.ts
│   │   ├── overlay-manager.ts
│   │   ├── login-manager.ts
│   │   └── hotkey-manager.ts
│   ├── ipc/
│   │   ├── index.ts
│   │   ├── window.ts
│   │   ├── lyrics.ts
│   │   ├── wallpaper.ts
│   │   ├── login.ts
│   │   └── misc.ts
│   ├── platform/
│   │   ├── index.ts             # 统一接口
│   │   ├── win32.ts             # Windows 专属实现
│   │   └── darwin.ts            # Mac 降级实现
│   └── preload/
│       ├── index.ts
│       └── overlay.ts
│
├── src/                         # React 渲染层
│   ├── main.tsx
│   ├── App.tsx
│   ├── components/
│   │   ├── Layout/
│   │   │   ├── TitleBar.tsx
│   │   │   └── WindowChrome.tsx
│   │   ├── Visualizer/
│   │   │   ├── Scene.tsx
│   │   │   ├── ParticleCloud.tsx
│   │   │   ├── SkullPreset.tsx
│   │   │   ├── CinemaCamera.tsx
│   │   │   └── presets/
│   │   ├── Lyrics/
│   │   │   ├── StageLyrics.tsx
│   │   │   ├── LyricLine.tsx
│   │   │   └── DesktopLyrics.tsx
│   │   ├── Shelf/
│   │   │   ├── ShelfScene.tsx
│   │   │   ├── ShelfCard.tsx
│   │   │   └── ShelfDetail.tsx
│   │   ├── Player/
│   │   │   ├── PlayerBar.tsx
│   │   │   ├── TrackInfo.tsx
│   │   │   ├── QualityBadge.tsx
│   │   │   └── PlayerGlass.tsx
│   │   ├── Search/
│   │   │   ├── SearchBar.tsx
│   │   │   └── SearchResults.tsx
│   │   ├── Settings/
│   │   │   ├── SettingsPanel.tsx
│   │   │   ├── VisualSettings.tsx
│   │   │   ├── HotkeySettings.tsx
│   │   │   └── AccountSettings.tsx
│   │   └── ui/
│   │       ├── GlassPanel.tsx
│   │       ├── Slider.tsx
│   │       └── Toggle.tsx
│   ├── stores/
│   │   ├── player.ts
│   │   ├── visual.ts
│   │   ├── playlist.ts
│   │   ├── lyrics.ts
│   │   ├── settings.ts
│   │   └── window.ts
│   ├── hooks/
│   │   ├── useAudio.ts
│   │   ├── useDesktopBridge.ts
│   │   └── useWeather.ts
│   ├── lib/
│   │   ├── audio-engine.ts
│   │   ├── lyric-parser.ts
│   │   └── dj-analyzer.ts      # 移植自现有 dj-analyzer.js（BPM/节拍分析）
│   └── types/
│       └── ipc.ts
│
├── overlays/
│   ├── desktop-lyrics/          # 独立 Vite 入口：desktop-lyrics.html + index.tsx
│   └── wallpaper/               # 独立 Vite 入口：wallpaper.html + index.tsx
│
├── server/
│   ├── index.ts
│   ├── lib/
│   │   ├── cookie.ts
│   │   ├── proxy.ts
│   │   └── update.ts
│   └── routes/
│       ├── netease.ts
│       ├── qq-music.ts
│       ├── weather.ts
│       ├── update.ts
│       └── static.ts
│
├── public/
├── build/
├── electron-vite.config.ts
├── tsconfig.json
├── tsconfig.node.json
└── package.json
```

---

## 4. Zustand Store 设计

### player.ts
```ts
interface PlayerStore {
  status: 'idle' | 'loading' | 'playing' | 'paused'
  currentTrack: Track | null
  position: number
  duration: number
  volume: number
  quality: 'standard' | 'higher' | 'exhigh' | 'lossless'
  source: 'netease' | 'qq'
  play(): void
  pause(): void
  seek(seconds: number): void
  setVolume(v: number): void
  loadTrack(track: Track): Promise<void>
}
```

### visual.ts
```ts
interface VisualStore {
  preset: PresetId
  playbackPreset: PresetId       // 切歌后恢复用
  fx: FxParams
  performanceMode: 'eco' | 'balanced' | 'high' | 'ultra'
  backgroundMode: 'auto' | 'keep' | 'release'
  setPreset(id: PresetId, opts?: { commitPlayback?: boolean }): void
  updateFx(partial: Partial<FxParams>): void
  saveArchive(name: string): void
  loadArchive(snapshot: FxSnapshot): void
}
```

### playlist.ts
```ts
interface PlaylistStore {
  playlists: Playlist[]
  currentPlaylist: Playlist | null
  queue: Track[]
  shelfVisible: boolean
  shelfMode: 'dynamic' | 'static'
  loadUserPlaylists(): Promise<void>
  next(): void
  prev(): void
  addToQueue(track: Track): void
}
```

### lyrics.ts
```ts
interface LyricsStore {
  lines: LyricLine[]
  currentIndex: number
  translation: LyricLine[]
  layout: LyricLayout
  desktopLyricsEnabled: boolean
  setLines(lines: LyricLine[], translation?: LyricLine[]): void
  tick(position: number): void
  updateLayout(partial: Partial<LyricLayout>): void
}
```

### settings.ts
```ts
interface SettingsStore {
  hotkeys: HotkeyBinding[]
  neteaseLoggedIn: boolean
  qqLoggedIn: boolean
  shelfShowPodcasts: boolean
  shelfMergeCollections: boolean
  liveBackgroundKeep: boolean
  saveToLocal(): void
  loadFromLocal(): void
  exportArchive(): string
  importArchive(json: string): void
}
```

### window.ts（只读，由主进程推送）
```ts
interface WindowStore {
  isMaximized: boolean
  isFullScreen: boolean
  isMinimized: boolean
  isFocused: boolean
  displayBounds: DisplayBounds | null
}
```

---

## 5. IPC 类型契约（src/types/ipc.ts）

```ts
export interface IpcChannels {
  'window:minimize':            { req: void;   res: void }
  'window:toggle-fullscreen':   { req: void;   res: void }
  'window:get-state':           { req: void;   res: WindowState }
  'window:close':               { req: void;   res: void }

  'login:netease-open':         { req: void;   res: LoginResult }
  'login:netease-clear':        { req: void;   res: OkResult }
  'login:qq-open':              { req: void;   res: LoginResult }
  'login:qq-clear':             { req: void;   res: OkResult }

  'lyrics:set-enabled':         { req: { enabled: boolean; payload?: LyricsPayload }; res: OkResult }
  'lyrics:update':              { req: LyricsPayload; res: OkResult }
  'lyrics:set-lock':            { req: { locked: boolean }; res: OkResult }
  'lyrics:move-by':             { req: { dx: number; dy: number }; res: OkResult }

  'wallpaper:set-enabled':      { req: { enabled: boolean }; res: OkResult }
  'wallpaper:update':           { req: WallpaperPayload; res: OkResult }

  'hotkeys:configure':          { req: HotkeyBinding[]; res: HotkeyResult }

  'file:export-json':           { req: ExportPayload; res: FileResult }
  'file:import-json':           { req: void; res: ImportResult }

  'app:restart':                { req: void; res: OkResult }
  'app:open-update':            { req: { filePath: string }; res: OkResult }
}

export interface IpcEvents {
  'window:state-changed':           WindowState
  'lyrics:lock-state-changed':      { locked: boolean }
  'lyrics:enabled-state-changed':   { enabled: boolean }
  'hotkey:triggered':               { action: string }
}
```

---

## 6. Platform 层接口

```ts
// electron/platform/index.ts
export interface PlatformAdapter {
  // 桌面歌词鼠标中键全局检测
  startMousePoller(onMiddleClick: () => void): void
  stopMousePoller(): void

  // 壁纸窗口注入到桌面层
  attachWallpaperToDesktop(hwnd: string): void

  // 桌面快捷方式
  ensureDesktopShortcut(): { ok: boolean }
}

// win32.ts：完整实现（PowerShell、WorkerW、.lnk）
// darwin.ts：全部降级（空函数 + 日志）
```

---

## 7. Mac 适配策略

| 功能 | Windows | macOS |
|------|---------|-------|
| 壁纸模式 | WorkerW 注入 | **禁用**（UI 显示"仅 Windows 支持"） |
| 桌面歌词中键切换 | PowerShell GetAsyncKeyState | **禁用**（只能用主窗口按钮） |
| 桌面快捷方式 | .lnk 文件 | **跳过** |
| 图标格式 | icon.ico | icon.icns（由 icon.png 生成） |
| 应用标识 | AppUserModelId | 不需要 |
| 全屏行为 | setFullScreen | 相同 API，macOS 原生全屏 |
| 构建目标 | NSIS .exe | DMG（x64 + arm64 Universal） |

---

## 8. Server 层设计

`server/index.ts` 启动 HTTP server 并挂载路由，与 Electron 主进程解耦（可单独 `ts-node server/index.ts` 调试）。

路由职责：
- `netease.ts`：搜索、歌曲 URL、歌词、歌单、扫码登录、DJ 电台
- `qq-music.ts`：搜索、播放 URL、cookie 注入
- `weather.ts`：Open-Meteo 天气预报 + IP 定位
- `update.ts`：GitHub Release 版本检查、补丁/安装包下载、digest 校验
- `static.ts`：`public/` 静态文件服务

**修复原项目 bug：** 原 `server.js` 中 `BEATMAP_CACHE_DIR` 硬编码为 `D:\\MineradioCache\\beatmaps`，新项目改用 `app.getPath('userData')` 动态路径，跨平台兼容。

用户存档（`.json`）格式与现有 Mineradio 完全兼容，可直接导入导出。

---

## 9. 构建配置

```json
"scripts": {
  "dev":       "electron-vite dev",
  "build":     "electron-vite build",
  "build:win": "npm run build && electron-builder --win",
  "build:mac": "npm run build && electron-builder --mac"
}
```

Mac 构建需在 macOS 上执行；Windows 构建在 Windows 或 CI 上执行。

---

## 10. 不在本次范围内

- 前端框架迁移以外的新功能（情绪节奏音效大师等留在原项目规划）
- Tauri 迁移
- server/ 的完整单元测试套件
