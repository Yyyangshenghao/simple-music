# 目录结构说明

> 逐目录说明职责与关键文件。模块内部设计见 [modules/](modules/) 分册。

```
Mineradio-Next/
├── electron/                  # 主进程（tsconfig.node.json）
│   ├── main.ts                # 入口：Chromium 开关 → 单实例锁 → registerIpc → bootServer → createMainWindow
│   ├── server-host.ts         # 内嵌启动 server/index.ts，注入 userData 路径，before-quit 关闭
│   ├── ipc/                   # IPC handler 按域拆分注册
│   │   ├── index.ts           #   registerIpc() 汇总
│   │   ├── window.ts          #   window:*（最小化/全屏/关闭/状态）
│   │   ├── login.ts           #   login:*（网易/QQ 登录窗口开关与清除）
│   │   ├── lyrics.ts          #   lyrics:* 主契约 + overlay:lyrics-* 悬浮窗内部通道
│   │   ├── wallpaper.ts       #   wallpaper:*
│   │   └── misc.ts            #   热键配置、JSON 导入导出对话框、app:restart / app:install-update
│   ├── modules/
│   │   ├── window-manager.ts  #   主窗口创建（无边框 16:9）、WindowState 计算与推送、dev/prod URL 解析
│   │   ├── overlay-manager.ts #   桌面歌词/壁纸两个 BrowserWindow 的生命周期、定位、状态缓存转发、鼠标穿透
│   │   ├── hotkey-manager.ts  #   globalShortcut 注册/冲突上报，触发后发 hotkey:triggered
│   │   ├── login-manager.ts   #   独立登录窗口（session 分区），轮询抓 cookie 组装 Cookie 头
│   │   ├── update-installer.ts        # Windows NSIS 静默安装 / macOS dmg 挂载替换（Electron 胶水）
│   │   └── update-installer-logic.ts  # 上者的纯逻辑部分（mac swap 脚本生成），electron/ 下唯一可单测文件
│   ├── platform/              # 平台能力接口 getPlatform()
│   │   ├── index.ts           #   PlatformAdapter 接口定义
│   │   ├── win32.ts           #   完整实现：PowerShell 鼠标中键轮询、壁纸注入 WorkerW、桌面快捷方式
│   │   └── darwin.ts          #   降级空实现（记录日志）
│   └── preload/
│       ├── index.ts           #   主窗口桥 window.desktop（serverPort 从启动参数读出）
│       └── overlay.ts         #   悬浮窗桥 window.desktopOverlay
│
├── server/                    # 内嵌 HTTP API server（tsconfig.node.json；可 npm run server:dev 独立跑）
│   ├── index.ts               # createServer + 路由链（handler 返回 true=已处理）；CORS 全放行
│   ├── types.ts               # ServerContext（userDataDir/port）、RouteHandler 签名
│   ├── routes/
│   │   ├── netease.ts         #   网易云全部端点 + /api/audio /api/cover 代理 + 音频缓存管理
│   │   ├── qq-music.ts        #   /api/qq/* 全部端点（薄调度层，逻辑在 lib/qq-client）
│   │   ├── podcast.ts         #   播客搜索/热门/节目/我的播客 + DJ 长音频离线锁拍入口
│   │   ├── beatmap.ts         #   节拍图磁盘缓存读写
│   │   ├── weather.ts         #   天气电台 + IP 定位
│   │   ├── update.ts          #   版本/更新检查/安装包下载任务/补丁任务（补丁在新架构不支持）
│   │   └── static.ts          #   静态文件兜底（伺服 userDataDir/public；主窗口实际走 file:// 加载，此路由主要服务独立运行模式）
│   └── lib/
│       ├── netease-client.ts  #   NCM 包调用封装、cookie 规范化、登录态/VIP 归一、字段映射（领域类型事实来源）、音质阶梯与播放限制分类
│       ├── qq-client.ts       #   QQ 上游请求（musicu.fcg/smartbox 等）、cookie/uin/musicKey 解析、vkey 取链、全部业务 handler
│       ├── cookie.ts          #   cookie-{netease,qq}.txt 落盘读写 + 节拍图缓存目录
│       ├── http.ts            #   readBody/readJson/sendJson/sendError
│       ├── audio-cache.ts     #   音频磁盘缓存：sha1 键、.part 原子落盘、2GB mtime-LRU、Range 解析
│       ├── beatmap.ts         #   节拍图 JSON 缓存文件（含 C 盘禁用判定，兼容原项目）
│       ├── dj-analyzer.ts     #   播客 DJ 锁拍算法（mpg123 解码 + 双二阶滤波 + 网格锁拍），忠实移植
│       ├── weather.ts         #   Open-Meteo/ip-api 封装、天气→情绪→种子查询→选曲排序
│       └── update.ts          #   GitHub Release/latest.yml/manifest 检查、镜像线路、下载任务队列、digest 校验
│
├── src/                       # 主窗口渲染层（tsconfig.json，别名 @renderer/* → src/*）
│   ├── main.tsx               # createRoot 入口
│   ├── App.tsx                # 全局 hooks 装配 + 四层布局（TopBar/AppShell/PlayerBar/LyricsPanel）
│   ├── stores/                # zustand，单文件单 store（见 modules/renderer.md §stores）
│   ├── hooks/                 # 全局副作用 hooks，大多在 App.tsx 挂载一次
│   ├── lib/                   # 纯逻辑/服务层（api、audio-engine、music-service、各算法纯函数）
│   ├── pages/                 # ExplorePage / LibraryPage / RoamPage / SettingsPage / ArtistPage
│   ├── components/            # 按域分目录：Layout/ Player/ Lyrics/ Explore/ Playlist/ Search/ Shelf/ Artist/ Update/ Visualizer/ ui/
│   ├── styles/                # tokens.css（全部设计 token）/ global.css / scroll-gradients.css
│   ├── data/                  # default-fx-archive.json（FxParams 默认值，须与 public/ 存档格式互通）
│   └── types/                 # domain.ts（领域类型）/ ipc.ts（IPC 契约，主进程共享）/ global.d.ts（window.desktop 声明）
│
├── overlays/                  # 悬浮窗渲染入口（多页构建，见 electron.vite.config.ts renderer.input）
│   ├── desktop-lyrics/        # index.tsx + desktop-lyrics.html：渲染 DesktopLyrics，处理拖动/穿透
│   └── wallpaper/             # index.tsx + wallpaper.html：渲染 Visualizer/Scene，自带独立 visual store
│
├── public/                    # 静态资源（default-user-fx-archive.json 为存档格式互通基准）
├── build/                     # 打包资源（icon.ico / icon.icns）
├── docs/                      # 本文档体系（索引见 docs/README.md）
├── electron.vite.config.ts    # main/preload/renderer 三段构建配置（renderer 多页：index + 两个 overlay）
├── tsconfig.json / tsconfig.node.json
├── package.json               # scripts、electron-builder build 配置、simplemusic.update 更新源配置
├── CLAUDE.md                  # AI 协作指南（架构速览 + 易踩坑约定）
├── DESIGN.md                  # 视觉设计参考（Spotify 体系分析，select-design 技能导入）
└── README.md                  # 用户向说明（下载/功能/鸣谢/License GPL-3.0）
```

## 测试文件分布

测试与源码同目录（`*.test.ts`），vitest 直接跑，无独立 test 目录：

- `server/lib/`：http、cookie、qq-client、dj-analyzer、update、audio-cache
- `server/routes/`：netease.audio-proxy（音频代理转发/背压/缓存旁路）
- `src/lib/`：api、audio-energy、extract-color、lazy-window、lyric-parser、playback-persistence、roam-description、roam-selection、search-history、stack-pool、track-fallback、track-preload
- `src/stores/`：likes、roam、stores（综合）
- `electron/modules/`：update-installer-logic（electron/ 下唯一可单测的纯逻辑）

## 历史文档

- `docs/specs/`、`docs/superpowers/{specs,plans}/`：按日期命名的各次改版设计/计划文档，是理解历史意图的一手资料（只增不改）。
- `docs/roadmap.md`：功能路线图，完成项就地勾掉并补落地说明。
- `docs/netease-music-api.md`、`docs/qq-music-api.md`：上游接口逆向笔记（接口来源、参数、坑）。
