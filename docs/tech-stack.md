# 技术栈与依赖说明

> 每个依赖回答三个问题：干什么用、在哪里用、为什么选它/有什么替代考量。
> 版本以 `package.json` 为准；本文按当前依赖与实现维护，不把历史方案中的版本号当作现行要求。

## 运行时依赖（dependencies）

| 依赖 | 用在哪 | 说明 |
|---|---|---|
| `react` / `react-dom` ^18.3 | `src/`、`overlays/` | 渲染层框架。`lazy + Suspense` 按需加载页面、3D 歌词与流体背景；启动时不集中预热全部页面。 |
| `zustand` ^4.5 | `src/stores/` | 状态管理。选它的原因：无 Provider、store 可在非组件环境 `getState()` 互调（player↔playlist↔settings 大量非 hook 调用）、`subscribe(fn)` 直接做持久化/联动订阅。 |
| `motion` ^12 | 全渲染层 | framer-motion 的后继包（import 自 `motion/react`）。页面转场（AnimatePresence popLayout）、共享元素（layoutId `explore-cover-*`）、弹簧参数集中在 `src/lib/motion-presets.ts`。 |
| `three` ^0.169 | Visualizer、LiquidEther | WebGL 基础库。LiquidEther 直接用裸 three（RawShaderMaterial + 自管渲染循环），不经 r3f。 |
| `@react-three/fiber` ^8 | 按需加载的 LyricsScene、壁纸 Scene | three 的 React 绑定。有帧率上限时使用 `frameloop="never"` + `FrameLimiter` 主动推进；不限帧率时使用 `always`。 |
| `gsap` ^3.15 | `components/Layout/FlowingMenu` | 与 motion 并存：motion 管声明式组件动效，gsap 只管 FlowingMenu 的命令式时间线。 |
| `d3-force` ^3 | 漫游歌手关系图 | 对歌手节点执行力导向布局；可测试的图谱模拟逻辑在 `src/lib/artist-graph-sim.ts`。 |
| `NeteaseCloudMusicApi` ^4.32 | `server/lib/netease-client.ts` | 网易云接口封装（Binaryify，MIT）。注意：CommonJS 包，ESM 下接口函数挂在 `default` 上，`netease-client.ts` 统一解包成 `ncmTable`，并用 `has()/call()` 做可用性探测（不同版本导出面不同）。 |
| `mpg123-decoder` ^1 | `server/lib/dj-analyzer.ts` | WASM MP3 解码器，纯 Node 侧解码播客长音频做锁拍分析（不依赖浏览器 AudioContext）。动态 `import()` 按需加载。 |
| `music-metadata` ^11 | `server/lib/local-library.ts` | 扫描本地音乐时读取标题、歌手、专辑、时长与内嵌封面；文件访问始终通过本地索引 id 反查。 |
| `koffi` 2.16.3 | `electron/modules/macos-lyrics-window.ts`、`lyrics-native-backdrop.ts` | macOS 桌面歌词的非激活交互和局部 AppKit 毛玻璃；仅 macOS 按需加载，原生文件通过 `asarUnpack` 解包。非激活标记使用私有接口，升级系统或 Electron 后需实测；毛玻璃使用公开接口，失败回退暗灰底框。 |

## 开发依赖（devDependencies）

| 依赖 | 说明 |
|---|---|
| `electron`（CastLabs ECS 42） | 主框架；受保护 Apple Music 播放需要 Widevine。正式发布的安装包必须经 EVS streaming VMP 生产签名，见 [构建与发布](build-and-release.md)。 |
| `electron-vite` ^2 | 三段构建（main/preload/renderer 各自打包）；dev 模式渲染层跑 vite dev server（5173），经 `ELECTRON_RENDERER_URL` 注入主进程。 |
| `electron-builder` ^26 | 打包分发：mac dmg（x64+arm64）、win NSIS 安装版 + portable。配置内联在 package.json `build` 字段。 |
| `vite` ^5 / `@vitejs/plugin-react` ^4 | electron-vite 的底层。 |
| `typescript` ^5.5 | 严格模式；两套 tsconfig 见架构文档。 |
| `@types/node` / `@types/react` / `@types/react-dom` / `@types/three` / `@types/d3-force` | Node、React、Three.js 与 d3-force 的 TypeScript 声明，只参与类型检查。 |
| `vitest` ^2 | 测试跑器，`npm test` = `vitest run`；单文件：`npx vitest run src/lib/stack-pool.test.ts`。 |
| `tsx` ^4 | `npm run server:dev` 直接跑 TS 的 server 入口。 |

## 刻意没有引入的东西

- **路由库**：视图状态是带对象参数的联合类型（playlist 详情携带 tracks），自研 navigation store（history/future 双栈 + 转场方向）比 URL 路由更贴合。
- **CSS 框架 / CSS-in-JS**：CSS Modules + tokens.css 设计变量；主题切换零 JS 开销（`data-theme` + `prefers-color-scheme`）。
- **electron-updater**：更新流程自研（server/lib/update.ts + electron/modules/update-installer.ts），原因是需要国内镜像多线路与 digest 校验。Windows 端安装参数（`/S --force-run`）与 electron-updater 的 NsisUpdater 对齐；macOS 未签名，下载后仅打开 dmg，由用户在 Finder 中完成替换。
- **lint 工具**：无 eslint/prettier 配置，验证以 `typecheck` + `test` 为准。

## 上游接口形态（外部"依赖"）

| 上游 | 接入方式 | 风险 |
|---|---|---|
| 网易云音乐 | `NeteaseCloudMusicApi` 包（本地起调用，非公网服务） | 包版本与网易改版双重风险；接口可用性用 `has()` 探测 + 多路兜底（如 lyric_new→lyric、playlist_detail→playlist_track_all）。 |
| QQ 音乐 | 直接 fetch Web 端接口（`u.y.qq.com/cgi-bin/musicu.fcg` 等），逆向来源见 [qq-music-api.md](qq-music-api.md) | 无官方 API；接口曾整体不可用（2026-07-05），vkey/鉴权逻辑对 cookie 形态敏感。 |
| Apple Music | 应用内 Apple 官网会话 + MusicKit；开发态受保护播放使用系统 Chrome，另有开发者令牌备用模式 | 需要有效 Apple Music 订阅；受官网结构、地区、DRM 与生产签名影响。播放不进入本地音频代理或离线缓存，详见 [接入记录](specs/2026-09-17-apple-music-integration.md)。 |
| Open-Meteo / ip-api.com | 免 key 公共接口 | 天气电台专用，失败有本地兜底电台。 |
| GitHub Releases + 国内镜像 | 更新检查/下载 | 镜像列表配置在 package.json `simplemusic.update.mirrors`，支持 `{url}`/`{encodedUrl}` 模板。 |

## 环境要求

- 本地开发使用支持全局 `fetch` 与 `AbortSignal.timeout` 的 Node 20+；发布流水线固定 Node 22.12，运行 `npm ci`、类型检查、测试并构建签名安装包。
- 平台：macOS 优先（开发机），Windows 完整支持（含桌面歌词中键、壁纸注入等 win32 专属能力），Linux 仅理论可跑（更新资源选择有 AppImage/deb 分支但未打包）。
