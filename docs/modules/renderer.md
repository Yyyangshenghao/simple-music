# 渲染层(`src/`)

React 18 + zustand + motion(framer-motion 后继)+ three.js(@react-three/fiber)。入口 `src/main.tsx` → `App.tsx`。别名 `@renderer/*` → `src/*`。

## App.tsx 装配

`App.tsx` 挂载全部全局 hooks(桥接/播放/歌词/壁纸/氛围色),布局为固定四层:`TopBar` + `AppShell`(页面容器)+ `PlayerBar` + `LyricsPanel`(全屏歌词,打开时隐藏 TopBar)。主题经 `data-theme` 属性写到 `<html>`,`auto` 模式移除属性交给 CSS 媒体查询。

## stores(zustand,单文件单 store)

| store | 职责 |
|---|---|
| `player.ts` | 播放状态/进度/音量/音质;懒创建 `AudioEngine` 单例;`loadTrack` 解析 URL 并播放 |
| `playlist.ts` | 播放队列 + 用户歌单/书架(Shelf)数据 |
| `navigation.ts` | 页面路由(`AppView` 联合类型:explore/library/settings/artist/playlist);playlist 视图携带已拉取曲目避免重复请求;记录 lastAction 供转场方向 |
| `settings.ts` | 通用用户设置，localStorage key `simplemusic-settings`；含热键、主题、歌词面板模式、reduce-transparency 等，不再保存互斥音源 |
| `providers.ts` | 多平台启用、登录态、资料、全局内容平台与播放优先级；平台偏好使用 `simplemusic-provider-settings`，内容平台使用 `simplemusic-content-provider` |
| `visual.ts` | 可视化 FxParams/预设/性能模式;默认值来自 `src/data/default-fx-archive.json` |
| `ambient.ts` | 氛围三色(主/副/点缀),来自封面取色 |
| `lyrics.ts` | 歌词行 + 当前行 tick(由播放进度驱动)+ 3D 歌词布局 |
| `window.ts` | 只读窗口状态,由主进程经 `useDesktopBridge` 推送 |

## hooks(全局副作用,大多在 App.tsx 挂载一次)

- `useDesktopBridge` — 订阅主进程窗口状态/热键触发,写入 window store。
- `useAudio` — 播放进度 → lyrics store tick。
- `useLyricsFetch` — 换歌时拉歌词。
- `useDesktopLyricsSync` / `useWallpaperSync` — 把当前歌词/可视化状态经 IPC 推给悬浮窗。
- `useAmbientPalette` — 封面取色(`lib/extract-color.ts`)→ ambient store → `--ambient-1/2/3` CSS 变量。
- `useAudioEnergy` — AnalyserNode 频谱 → rAF 写 `--audio-energy` 变量(驱动 PlayerGlass 等辉光)。
- `useContentProvider` — 解析探索与我的库共用的全局内容平台；`serviceFor(entity.source)` 按实体复合身份取对应 service，全源搜索等聚合场景经 `ContentHub` 隔离参与平台。
- `useScrollGradient` / `useScrollReveal` — 滚动渐隐边缘 / 入场 stagger。

## lib

- `music-service.ts` — `MusicService` 接口(推荐/歌单/搜索/歌手/URL/歌词);`getDailySongs`/`getRadarPlaylist` 为网易专属可选方法,未实现则不渲染对应卡片。实现:`netease-music-service.ts`、`qq-music-service.ts`。
- `api.ts` — HTTP 客户端,端口来自 `window.desktop.serverPort`,API token 来自 `window.desktop.serverToken`(统一带进 query,见 server.md 安全边界);非 Electron 环境回退同源(纯前端调试)。
- `audio-engine.ts` — 单例 HTMLAudioElement 走 `/api/audio` 代理 + AnalyserNode 暴露频谱。
- `lyric-parser.ts` — LRC/逐字歌词解析。
- `stack-pool.ts` — 探索页 Stack 卡片堆的池子管理(纯函数,有测试)。
- `toplist-cache.ts` — 榜单预览的并发池 + 分组缓存,进榜单页即后台预取全部榜单 Top3(2026-07-24 加,滚动卡顿主因之一)。
- `motion-presets.ts` / `animation.ts` — 全项目动效预设;新动效必须引用而非自写参数。
- `extract-color.ts` / `audio-energy.ts` — 取色与能量计算纯函数(均有测试)。

## components / pages

页面:`ExplorePage`(当前内容平台的原生推荐)、`LibraryPage`(当前内容平台的歌单与收藏)、`ArtistPage`、`SettingsPage`。`GlobalContentProviderDock` 在布局层统一控制探索与我的库。组件按域分目录:`Layout/`(WindowChrome 无边框窗口、TopBar、AppShell 转场、AmbientBackground)、`Player/`、`Lyrics/`(LyricsPanel 全屏歌词、StageLyrics 3D 舞台、KtvLine 逐字、DesktopLyrics 供悬浮窗复用)、`Explore/`、`Search/`、`Shelf/`、`Visualizer/`(three.js 场景与预设)、`ui/`(通用小组件)。

样式:CSS Modules 与组件同目录;设计 token 全部在 `src/styles/tokens.css`(`--sm-*` 基础、`--glass-*` 玻璃层级、`--ambient-*` 氛围色、`--audio-energy`),经 `@property` 注册可平滑过渡。`reduce-transparency` 开关(见 settings store)经 `App.tsx` 写 `data-reduce-transparency` 属性,tokens.css 内对应分支把玻璃 blur 降为纯色底、流体背景退化为静态霞光。

## 注意事项

- 封面共享元素转场依赖 layoutId 约定 `explore-cover-*` / `library-cover-*`。
- 全屏 WebGL(LiquidEther / Visualizer Scene)同屏只跑一个。
- 异步加载要用会话计数 ref 丢弃过期响应(参考 `ProviderRecommendationSection.sessionRef`)。
- `Track.duration` 单位是毫秒(见根 CLAUDE.md 关键约定)。
