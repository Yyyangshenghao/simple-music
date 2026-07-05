# 悬浮窗(`overlays/`)

两个独立 BrowserWindow 渲染入口,由 electron.vite.config.ts 的 renderer.input 注册多页构建,复用 `src/` 的组件与 store,通过 `electron/preload/overlay.ts` 暴露的 `window.desktopOverlay` 与主进程通信。窗口生命周期与定位由 `electron/modules/overlay-manager.ts` 管理(含显示器变化时重定位)。

## desktop-lyrics(桌面歌词)

`overlays/desktop-lyrics/index.tsx` + `desktop-lyrics.html`。渲染 `src/components/Lyrics/DesktopLyrics.tsx`。

- 数据流:主窗口 `useDesktopLyricsSync` → `lyrics:update` IPC → overlay-manager 缓存并转发 → `overlay.onLyricsState` 收 `LyricsPayload`。
- 自身交互(拖动/锁定/穿透)走 `overlay:lyrics-*` 通道:set-dragging、move-by、set-lock、set-hot-bounds(热区,配合鼠标穿透)、set-pointer-capture、close。

## wallpaper(动态壁纸)

`overlays/wallpaper/index.tsx` + `wallpaper.html`。直接渲染 `src/components/Visualizer/Scene.tsx`。

- 壁纸窗口是独立渲染进程,自带一份 visual store;主窗口 `useWallpaperSync` 经 `wallpaper:update` 推送 FxParams,入口处 `useVisualStore.getState().updateFx()` 同步到本地 store。
- 注意:主窗口与壁纸各自可能跑全屏 WebGL,"同屏只跑一个"的约束指单个窗口内。

## 修改注意

- 新增悬浮窗需同时改:electron.vite.config.ts(renderer input)、overlay-manager(创建/定位)、preload/overlay.ts(桥)、`src/types/ipc.ts`(payload 类型)。
- overlay 入口不走 `index.html` 的主 App,不要在其中引入依赖主窗口全局 hooks 的组件。
