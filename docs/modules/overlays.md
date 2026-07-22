# 悬浮窗(`overlays/`)

三个独立 BrowserWindow 渲染入口,由 electron.vite.config.ts 的 renderer.input 注册多页构建,复用 `src/` 的组件与 store,通过 `electron/preload/overlay.ts` 暴露的 `window.desktopOverlay` 与主进程通信。窗口生命周期与定位由 `electron/modules/overlay-manager.ts` 管理(含显示器变化时重定位)。

## desktop-lyrics(桌面歌词)

`overlays/desktop-lyrics/index.tsx` + `desktop-lyrics.html`。渲染 `src/components/Lyrics/DesktopLyrics.tsx`。

- 数据流:主窗口 `useDesktopLyricsSync` → `lyrics:update` IPC → overlay-manager 缓存并转发 → `overlay.onLyricsState` 收 `LyricsPayload`。
- 自身交互(拖动/锁定/穿透)走 `overlay:lyrics-*` 通道:set-dragging、move-by、set-lock、set-hot-bounds(热区,配合鼠标穿透)、set-pointer-capture、close。

## wallpaper(动态壁纸)

`overlays/wallpaper/index.tsx` + `wallpaper.html`。直接渲染 `src/components/Visualizer/Scene.tsx`。

- 壁纸窗口是独立渲染进程,自带一份 visual store;主窗口 `useWallpaperSync` 经 `wallpaper:update` 推送 FxParams,入口处 `useVisualStore.getState().updateFx()` 同步到本地 store。
- 注意:主窗口与壁纸各自可能跑全屏 WebGL,"同屏只跑一个"的约束指单个窗口内。

## mini-player(迷你悬浮播放条)

`overlays/mini-player/index.tsx` + `mini-player.html` + `mini-player.css`(重置层)。渲染 `src/components/Player/MiniPlayerBar.tsx`。

- 开关在**播放栏右侧**的 `MiniPlayerButton`(不在设置页);设置页只留外观项(不透明度/模糊/色调/进度条/歌词)。
- 数据流:主窗口 `useMiniPlayerSync` 拆三条 effect 推送(曲目态、1Hz 进度、歌词行)→ `miniplayer:update`;回程控制走 `overlay:miniplayer-control` → 主进程转 `miniplayer:control` 事件 → `useDesktopBridge` 落到 player/playlist store。
- 尺寸:高度锁死(常态 80,音量弹层展开 136,底边不动);宽度由自绘右边缘手柄经 `overlay:miniplayer-resize-by` 改窗口,主进程再用 `miniplayer:width-changed` 回传主窗口持久化。宽度 ≥ `MINI_PLAYER_LYRICS_WIDTH` 时展开歌词行。
- 窗口 `resizable: false`,尺寸只由 `setBounds` 改(改尺寸前临时 `setResizable(true)`,否则 macOS 会忽略);放开 OS 边缘拖拽会与自绘手柄同帧各改一次宽度而抖动。
- 透明留白区在 OS 层面同样挡桌面点击(CSS `pointer-events: none` 不解决),所以弹层空间是按需长高而非常驻。
- 共享常量在 `src/lib/mini-player-config.ts`,单独成文件是为了让 overlay 入口不把 zustand store 链打进包里。

## 修改注意

- 新增悬浮窗需同时改:electron.vite.config.ts(renderer input)、overlay-manager(创建/定位)、preload/overlay.ts(桥)、`src/types/ipc.ts`(payload 类型)。
- overlay 入口不走 `index.html` 的主 App,不要在其中引入依赖主窗口全局 hooks 的组件。
