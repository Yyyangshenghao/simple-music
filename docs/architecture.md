# 架构总览

> 本文是全项目的顶层设计文档：进程模型、模块划分、数据流、启动时序与贯穿全项目的设计决策。
> 各模块内部细节见 [modules/](modules/) 下的分册；播放、算法、视觉等横切系统见 [playback-system.md](playback-system.md)、[algorithms.md](algorithms.md)、[visuals-and-shaders.md](visuals-and-shaders.md)。

Simple Music（包名 `simplemusic`）是一个 Electron 桌面音乐播放器：React 渲染层 + 主进程内嵌的 Node HTTP API server，音源支持网易云音乐与 QQ 音乐。项目起点是对 [Mineradio](https://github.com/XxHuberrr/Mineradio)（GPL-3.0）的移植式重写——整体架构已完全重写为 electron-vite + TypeScript，但部分算法/上游接口逻辑（dj-analyzer、win32 桌面注入、部分 server 路由）是"忠实移植"，行为对齐优先于重构（源码中标注了"移植自参考项目"的位置改动前需先确认上游语义）。

## 1. 进程模型

```
┌────────────────────────── Electron 主进程 ──────────────────────────┐
│  electron/main.ts                                                   │
│  ├─ server-host.ts ──► 内嵌 HTTP API server（server/，127.0.0.1 随机端口）│
│  ├─ modules/window-manager.ts ──► 主窗口（无边框，16:9）               │
│  ├─ modules/overlay-manager.ts ──► 桌面歌词窗 + 壁纸窗（两个独立渲染进程）│
│  ├─ modules/hotkey-manager.ts（globalShortcut）                       │
│  ├─ modules/login-manager.ts（独立登录窗口，session 分区抓 cookie）      │
│  ├─ modules/update-installer.ts（NSIS 静默安装 / mac dmg 原地替换）     │
│  └─ ipc/*（contextBridge 通道，类型契约在 src/types/ipc.ts）            │
└──────────────────────────────────────────────────────────────────────┘
        │ IPC（控制类）                    │ HTTP /api/*（数据类）
        ▼                                 ▼
┌─ 主窗口渲染进程 ─────────────┐   ┌─ API server（跑在主进程内）────────┐
│ src/（React 18 + zustand）   │   │ server/routes/* → server/lib/*     │
│ preload: window.desktop      │   │ ├─ netease（NeteaseCloudMusicApi）  │
└──────────────────────────────┘   │ ├─ qq-music（Web 接口逆向封装）      │
┌─ 桌面歌词渲染进程 ───────────┐   │ ├─ podcast / beatmap（DJ 锁拍）      │
│ overlays/desktop-lyrics      │   │ ├─ weather（Open-Meteo 天气电台）    │
│ preload: window.desktopOverlay│  │ ├─ update（GitHub Release + 镜像）   │
└──────────────────────────────┘   │ └─ audio/cover 代理 + 音频磁盘缓存   │
┌─ 壁纸渲染进程 ───────────────┐   └────────────────────────────────────┘
│ overlays/wallpaper           │
└──────────────────────────────┘
```

关键决策：

- **为什么内嵌 HTTP server 而不是全走 IPC**：音源请求逻辑（cookie 管理、上游封装、字段映射、音频流代理）是纯 Node 逻辑，做成独立 server 后可以 `npm run server:dev` 脱离 Electron 单独跑、单独测（vitest 直接 import route/lib），渲染层在浏览器里也能调试（`api.ts` 无端口时回退同源）。IPC 只留给"必须由主进程做"的窗口/系统类操作。
- **端口随机 + 参数注入**：server 监听 `127.0.0.1:0`（随机端口），端口经 `BrowserWindow webPreferences.additionalArguments` 传入 `--simplemusic-server-port=<port>`，preload 从 `process.argv` 读出挂到 `window.desktop.serverPort`。避免固定端口被占用；仅监听 loopback，不暴露到局域网。
- **两套 tsconfig 隔离**：`tsconfig.node.json`（electron/ + server/，Node 环境）与 `tsconfig.json`（src/ + overlays/，DOM 环境），`npm run typecheck` 两套全跑。`src/types/ipc.ts` 是唯一被两侧共享的类型文件（主进程 import 渲染层类型，编译期共享、运行期无依赖）。

## 2. 四个顶层模块

| 模块 | 环境 | 职责 | 分册 |
|---|---|---|---|
| `electron/` | 主进程 | 窗口/悬浮窗/热键/登录/更新安装 + IPC + preload 桥 | [modules/electron-main.md](modules/electron-main.md) |
| `server/` | 主进程内嵌（可独立） | `/api/*` 全部数据端点、上游音源封装、音频代理与缓存、更新检查/下载、DJ 锁拍、天气电台 | [modules/server.md](modules/server.md) |
| `src/` | 主窗口渲染进程 | React UI：stores（zustand）/hooks/lib/components/pages | [modules/renderer.md](modules/renderer.md) |
| `overlays/` | 两个独立渲染进程 | 桌面歌词、动态壁纸入口（复用 `src/` 组件与 store） | [modules/overlays.md](modules/overlays.md) |

## 3. 启动时序

1. `electron/main.ts` 顶层：追加 Chromium 开关——`autoplay-policy=no-user-gesture-required`、GPU 光栅化/zero-copy、**关闭全部 background throttling**（后台计时器、渲染进程降级、遮挡窗口降级），ANGLE 后端按平台选 `d3d11`（win32）/`metal`（darwin）。
2. `requestSingleInstanceLock()`：拿不到锁直接退出；`second-instance` 事件聚焦已有窗口。
3. `app.whenReady` → `boot()`：`registerIpc()` → `bootServer()`（注入 `app.getPath('userData')` 为 `ServerContext.userDataDir`，返回端口）→ `createMainWindow(port)`。
4. 主窗口 `ready-to-show` 后显示；`screen` 的显示器变更事件驱动悬浮窗重定位与窗口状态推送。
5. 渲染层 `App.tsx` 挂载：全局 hooks（桥接/登录态同步/歌词/壁纸/氛围色）+ `loadFromLocal()`（settings）+ `initPlaybackPersistence()`（恢复上次队列为暂停态）+ `initMediaSession()` + 启动即 `checkForUpdate()`。
6. `before-quit`：注销热键 → 关闭悬浮窗 → 关闭 server。

**backgroundThrottling 全局关闭的连锁约定**：关闭后窗口最小化/被遮挡/失焦时 rAF 仍满帧跑，所有重渲染循环必须**自行暂停**——LiquidEther 内置 blur/visibilitychange/IntersectionObserver 三重暂停，LyricsPanel 3D 场景用 `useWindowActive()` 停 Canvas，`useAudioEnergy` 在 `document.hidden` 时跳帧。新增全屏渲染循环必须遵守这一约定（历史教训见 GPU 性能审计，风扇狂转主因）。

## 4. 数据流

### 4.1 内容数据（搜索/歌单/推荐…）

```
组件/页面
  → useMusicService()                    // 按 settings.activeSource 取单例
    或 serviceFor(数据.source)            // 跨音源数据必须按数据自带 source 绑定
  → MusicService 实现（netease-music-service.ts / qq-music-service.ts）
  → src/lib/api.ts                       // 拼 http://127.0.0.1:<port>/api/*
  → server/routes/*                      // 路由链
  → server/lib/*-client.ts               // 上游封装 + cookie
  → 上游平台（music.163.com / y.qq.com）
  → mapSongRecord / mapQQTrack 等映射为领域类型（src/types/domain.ts 的事实来源）
```

规则（易踩坑，违反过会产生真实 bug）：

- **渲染层绝不直接调音乐平台**，一律经本地 server。
- **`serviceFor(数据.source)` vs `useMusicService()`**：导航历史/缓存里的数据可能属于另一音源。用全局 activeSource 的 service 处理对侧数据，会把错误结果写进按 source 分键的缓存（useLazyPlaylist 曾因此出现"骨架永久占位"的 Critical）。凡是数据对象自带 `source` 字段的场景一律 `serviceFor`。
- **`Track.duration` 全项目约定毫秒**（网易 `dt` 原样、QQ `interval×1000`）。
- **`Track`/`Playlist` 的 `id` 是 `unknown`**（两音源 id 形态不同，QQ 主键实际是 `mid` 字符串），比较/拼 URL 前必须 `String()`。

### 4.2 音频播放链

```
player.loadTrack(track)
  → URL 解析：track.url（自带直链）→ 预加载缓存 → resolveSongUrl()（/api/song/url 或 /api/qq/song/url）
  → 都失败且开了跨音源兜底 → findFallbackTrack() 去对侧音源搜同曲
  → AudioEngine.load(upstreamUrl, startAt, cacheKey)
  → <audio src="http://127.0.0.1:<port>/api/audio?url=<上游CDN链>&cacheKey=source:id:quality">
  → server 代理：磁盘缓存命中直接本地文件服务（含 Range），未命中透传上游并把"从 0 起的整流"落盘
  → HTMLAudioElement → WebAudio 图：MediaElementSource → AnalyserNode → GainNode → destination
```

- Analyser 暴露频谱给全部可视化（能量辉光、粒子云、频谱环）；Gain 挂在 Analyser **之后**做 0.25s 淡入淡出包络，不污染频谱读数。
- 音频代理为什么存在：上游 CDN 有 Referer/UA 校验且跨域，`<audio>` 直连拿不到；代理统一补 header、加 CORS、顺带做磁盘缓存（2GB LRU）。
- 详见 [playback-system.md](playback-system.md)。

### 4.3 控制类通信（IPC）

窗口控制、桌面歌词/壁纸开关与状态推送、登录窗口、热键、文件对话框、更新安装走 IPC；payload 类型统一定义在 `src/types/ipc.ts`，渲染层只经 preload 桥（`window.desktop` / `window.desktopOverlay`）调用，从不裸用 `ipcRenderer`。通道全表见 [data-flow-and-ipc.md](data-flow-and-ipc.md)。

## 5. 渲染层状态架构

- **zustand 单文件单 store**，无全局 Provider；store 之间用 `getState()` 直接互调，环形依赖用注册回调解耦（player 播完 → playlist 走序，经 `registerTrackEndedHandler` 注入，避免 player→playlist 反向 import 成环）。
- **导航是自研的**（`stores/navigation.ts`）：`AppView` 联合类型 + history/future 双栈（上限 50 防内嵌全量 tracks 的 playlist 视图涨内存），没有引 react-router——视图形态少、需要携带对象参数（playlist 详情带已拉取的 tracks 避免重复请求）、转场方向（push/pop）要喂给 motion。
- **持久化分层**：设置类走 `simplemusic-settings`（settings store 手动 save/load）；播放态走 `simplemusic-playback`（节流落盘，恢复为暂停态断点续播）；其余各自独立 key（最近播放/搜索历史/漫游/更新忽略版本），全表见 [configuration.md](configuration.md)。
- **异步竞态守卫是全项目模式**：任何"响应回来时上下文可能已变"的异步加载，都用会话计数 ref（`loadSession`/`sessionRef`/`searchSeq`）判断响应是否过期后丢弃。player.loadTrack、ExplorePage、useLazyPlaylist、RoamPage 搜索、封面取色均如此；新加异步 setter 沿用该模式。

## 6. 视觉体系速览

- 设计方向见根目录 `DESIGN.md`（Spotify 深色内容优先体系）；token 全部在 `src/styles/tokens.css`（`--sm-*` 基础 / `--glass-*` 玻璃层级 / `--ambient-*` 封面取色氛围 / `--audio-energy` 音频能量），经 `@property` 注册。
- 动效统一引用 `src/lib/motion-presets.ts`（springSnappy/springGentle/tapScale/fadeRise/iconSwap），禁止散落魔法数值。
- 样式用 CSS Modules（`*.module.css` 与组件同目录）；主题切换靠 `<html data-theme>` + tokens 变量，`auto` 模式移除属性交给 `prefers-color-scheme`。
- **全屏 WebGL 同屏只跑一个**（单个窗口内）：氛围背景 LiquidEther 与歌词页 3D 场景互斥（歌词 3D 打开时 `AppShell backgroundHidden` 把背景 `display:none`，LiquidEther 靠 IntersectionObserver 自动暂停）。
- 深入解析（流体模拟管线、GLSL、性能档位）见 [visuals-and-shaders.md](visuals-and-shaders.md)。

## 7. 验证方式

无 lint 配置；验证以两条命令为准：

```bash
npm run typecheck   # tsconfig.node.json + tsconfig.json 两套全量
npm test            # vitest run（测试与源码同目录，*.test.ts）
```

测试集中在纯函数/纯逻辑层：server lib（http/cookie/qq-client/dj-analyzer/update/audio-cache）、src lib（api/audio-energy/extract-color/lazy-window/lyric-parser/playback-persistence/roam-*/search-history/stack-pool/track-fallback/track-preload）、stores（likes/roam/stores）、electron 侧唯一可单测的 `update-installer-logic`。涉及播放行为的改动需 `npm run dev` 实测。
