# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Mineradio-Next(包名 simplemusic)是一个 Electron 桌面音乐播放器:React 渲染层 + 主进程内嵌 Node HTTP API server,音源支持网易云音乐与 QQ 音乐。UI 与代码注释以中文为主。

## 常用命令

```bash
npm run dev            # electron-vite 开发模式(渲染层 5173,API server 随主进程启动)
npm run build          # electron-vite 构建到 out/
npm run typecheck      # 两套 tsconfig 全量类型检查(node 侧 + 渲染侧)
npm test               # vitest run(测试与源码同目录,*.test.ts)
npx vitest run src/lib/stack-pool.test.ts   # 跑单个测试文件
npm run server:dev     # 单独跑 API server(tsx server/index.ts,端口 35530)
npm run build:mac      # 打包 mac(build:win 同理)
```

无 lint 配置;验证以 `typecheck` + `test` 为准。

## 架构总览

四个顶层模块,两套 tsconfig 隔离:

- **`electron/`** — 主进程(窗口/悬浮窗/热键/登录管理 + IPC + preload)。tsconfig.node.json。
- **`server/`** — 内嵌 HTTP API server(`/api/*`),被主进程 `server-host.ts` 内嵌启动(端口随机,经 preload 参数 `--mineradio-server-port` 注入渲染层),也可独立运行。tsconfig.node.json。
- **`src/`** — React 渲染层(zustand stores + hooks + lib + components/pages)。tsconfig.json,别名 `@renderer/*`。
- **`overlays/`** — 两个独立悬浮窗渲染入口(桌面歌词、动态壁纸),复用 `src/` 组件,经 `electron/preload/overlay.ts` 通信。

数据流:渲染层 **不直接**调音乐平台 —— 组件 → `useMusicService()`(按 settings.activeSource 返回 Netease/QQ service 单例,均实现 `src/lib/music-service.ts` 的 `MusicService` 接口)→ `src/lib/api.ts`(拼 `http://127.0.0.1:<port>/api/*`)→ `server/routes/*` → `server/lib/*-client.ts` → 上游平台。音频播放走 `/api/audio` 代理,由渲染层 `AudioEngine`(单例 HTMLAudioElement + AnalyserNode)驱动。

模块细节见 `docs/modules/`:
- [renderer.md](docs/modules/renderer.md) — stores/hooks/lib/组件分区与视觉体系
- [electron-main.md](docs/modules/electron-main.md) — 主进程模块、IPC 通道、preload 桥
- [server.md](docs/modules/server.md) — 路由链、端点清单、上游 client
- [overlays.md](docs/modules/overlays.md) — 桌面歌词/壁纸悬浮窗

历史设计文档在 `docs/specs/` 与 `docs/superpowers/{specs,plans}/`(按日期命名,是理解各次改版意图的一手资料)。

## 关键约定(易踩坑)

- **`Track.duration` 全项目约定为毫秒**(网易 `dt` 原样、QQ `interval×1000`)。格式化参考 `SearchResults.tsx` 的 `formatDuration`(ms 入参);曾有把 ms 当秒显示的 bug(ca700db)。
- **异步竞态守卫**:切换音源/快速导航时,在途请求要丢弃。ExplorePage 用 `loadSession` 计数 ref 判断响应是否过期;新加异步 setter 沿用该模式。
- **动效统一引用 `src/lib/motion-presets.ts`**(springSnappy/springGentle/tapScale/fadeRise 等)与 `src/styles/tokens.css` 的 `--sm-*`/`--glass-*`/`--ambient-*`/`--glow-*` 变量,不要另写魔法数值。全屏 WebGL 场景同屏只跑一个。
- **样式用 CSS Modules**(`*.module.css` 与组件同目录),主题切换靠 `data-theme` 属性 + tokens.css 变量。
- **设置持久化**在 localStorage key `simplemusic-settings`(settings store);FxParams 存档格式需与 `public/default-user-fx-archive.json` 保持互通。
- **`Track`/`Playlist` 的 `id` 类型是 `unknown`**(两个音源 id 形态不同,QQ 还有 mid),比较/拼 URL 前先 `String()`。
- 网易私人雷达是固定歌单 id `3136952023` + 登录 cookie(`/api/netease/radar`);每日推荐/雷达为网易专属,`MusicService` 中是可选方法,未实现的音源不渲染对应卡片。
