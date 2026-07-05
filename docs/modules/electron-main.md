# 主进程(`electron/`)

入口 `electron/main.ts`:单实例锁 → `registerIpc()` → `bootServer()`(内嵌 API server,随机端口)→ `createMainWindow(port)`。启动时按平台追加 Chromium 性能开关(win32 用 ANGLE d3d11,darwin 用 metal)。

## 目录

- `server-host.ts` — 内嵌启动 `server/index.ts` 的 `startServer`,注入 `app.getPath('userData')`;`before-quit` 时关闭。
- `modules/window-manager.ts` — 主窗口创建(无边框、16:9 窗口化尺寸计算)、窗口状态推送(`window:state-changed`)、dev/prod 渲染 URL 解析。
- `modules/overlay-manager.ts` — 桌面歌词/壁纸两个悬浮窗的创建、定位(跟随显示器变化)、状态缓存与转发;见 [overlays.md](overlays.md)。
- `modules/hotkey-manager.ts` — `globalShortcut` 全局热键注册,触发后向渲染层发 `hotkey:triggered`。
- `modules/login-manager.ts` — 弹出独立登录窗口(网易 `persist:mineradio-netease-login` / QQ `persist:mineradio-qqmusic-login` 分区),从 session 抓 cookie 交给渲染层再传给 server。
- `platform/` — 平台能力接口(`getPlatform()`):win32 完整实现(快捷方式等),darwin/其它降级。
- `preload/index.ts` — 主窗口桥:`window.desktop`(isDesktop/platform/serverPort + 各 IPC 封装)。serverPort 经启动参数 `--mineradio-server-port=` 传入。
- `preload/overlay.ts` — 悬浮窗桥:`window.desktopOverlay`。
- `ipc/` — 按域拆分注册,`ipc/index.ts` 统一 `registerIpc()`。

## IPC 通道(invoke)

- `window:*` — minimize / maximize / close / toggle-fullscreen / exit-fullscreen-windowed / get-state
- `lyrics:*`(主窗口控制桌面歌词)— set-enabled / set-lock / move-by / update
- `overlay:lyrics-*`(歌词悬浮窗自身)— close / move-by / set-dragging / set-lock / set-hot-bounds / set-pointer-capture
- `wallpaper:*` — set-enabled / update
- `login:*` — netease-open / netease-clear / qq-open / qq-clear
- `hotkeys:configure`;`app:restart` / `app:open-update`;`file:export-json` / `file:import-json`(FX 存档导入导出)

主进程 → 渲染层推送:`window:state-changed`、`hotkey:triggered`,以及悬浮窗的 lyrics/wallpaper state 转发。

## 约定

- IPC payload 类型统一定义在 `src/types/ipc.ts`,主进程与渲染层共享;新增通道先加类型,preload 中封装,不让渲染层裸用 `ipcRenderer`。
- 渲染层与主进程只通过 preload 桥通信(contextBridge);数据类请求一律走 HTTP `/api/*` 而非 IPC。
