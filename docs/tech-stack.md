# 技术栈与依赖说明

> 每个依赖回答三个问题：干什么用、在哪里用、为什么选它/有什么替代考量。
> 版本以 `package.json` 为准（本文写作时 v1.3.0）。

## 运行时依赖（dependencies）

| 依赖 | 用在哪 | 说明 |
|---|---|---|
| `react` / `react-dom` ^18.3 | `src/`、`overlays/` | 渲染层框架。18 的并发特性未刻意使用，`lazy + Suspense` 用于页面代码分割（AppShell 空闲预热 chunk）。 |
| `zustand` ^4.5 | `src/stores/` | 状态管理。选它的原因：无 Provider、store 可在非组件环境 `getState()` 互调（player↔playlist↔settings 大量非 hook 调用）、`subscribe(fn)` 直接做持久化/联动订阅。 |
| `motion` ^12 | 全渲染层 | framer-motion 的后继包（import 自 `motion/react`）。页面转场（AnimatePresence popLayout）、共享元素（layoutId `explore-cover-*`）、弹簧参数集中在 `src/lib/motion-presets.ts`。 |
| `three` ^0.169 | Visualizer、LiquidEther | WebGL 基础库。LiquidEther 直接用裸 three（RawShaderMaterial + 自管渲染循环），不经 r3f。 |
| `@react-three/fiber` ^8 | LyricsPanel 3D 场景、壁纸 Scene | three 的 React 绑定。`frameloop="demand"` + `FrameLimiter` 实现帧率钳制。 |
| `@react-three/drei` ^9 | Visualizer 辅助 | r3f 常用工具集。 |
| `@react-three/postprocessing` ^2 | CoverParticleCloud | high/ultra 档的 Bloom + ACES ToneMapping 后期管线（eco/balanced 档不加载后期，辉光内嵌在 sprite shader 里）。 |
| `gsap` ^3.15 | 个别命令式动效 | 与 motion 并存：motion 管声明式组件动效，gsap 管少数命令式时间线（缓动常量见 `src/lib/animation.ts` 的 `ANIM`）。 |
| `NeteaseCloudMusicApi` ^4.32 | `server/lib/netease-client.ts` | 网易云接口封装（Binaryify，MIT）。注意：CommonJS 包，ESM 下接口函数挂在 `default` 上，`netease-client.ts` 统一解包成 `ncmTable`，并用 `has()/call()` 做可用性探测（不同版本导出面不同）。 |
| `mpg123-decoder` ^1 | `server/lib/dj-analyzer.ts` | WASM MP3 解码器，纯 Node 侧解码播客长音频做锁拍分析（不依赖浏览器 AudioContext）。动态 `import()` 按需加载。 |

## 开发依赖（devDependencies）

| 依赖 | 说明 |
|---|---|
| `electron` ^42 | 主框架。 |
| `electron-vite` ^2 | 三段构建（main/preload/renderer 各自打包）；dev 模式渲染层跑 vite dev server（5173），经 `ELECTRON_RENDERER_URL` 注入主进程。 |
| `electron-builder` ^26 | 打包分发：mac dmg（x64+arm64）、win NSIS 安装版 + portable。配置内联在 package.json `build` 字段。 |
| `vite` ^5 / `@vitejs/plugin-react` ^4 | electron-vite 的底层。 |
| `typescript` ^5.5 | 严格模式；两套 tsconfig 见架构文档。 |
| `vitest` ^2 | 测试跑器，`npm test` = `vitest run`；单文件：`npx vitest run src/lib/stack-pool.test.ts`。 |
| `tsx` ^4 | `npm run server:dev` 直接跑 TS 的 server 入口。 |

## 刻意没有引入的东西

- **路由库**：视图状态是带对象参数的联合类型（playlist 详情携带 tracks），自研 navigation store（history/future 双栈 + 转场方向）比 URL 路由更贴合。
- **CSS 框架 / CSS-in-JS**：CSS Modules + tokens.css 设计变量；主题切换零 JS 开销（`data-theme` + `prefers-color-scheme`）。
- **electron-updater**：更新流程自研（server/lib/update.ts + electron/modules/update-installer.ts），原因是需要国内镜像多线路、digest 校验、macOS 无签名场景（Squirrel.Mac 要求签名，故 mac 用 hdiutil 挂载 dmg 原地替换 .app + 失败回滚）。Windows 端安装参数（`/S --force-run`）与 electron-updater 的 NsisUpdater 对齐。
- **lint 工具**：无 eslint/prettier 配置，验证以 `typecheck` + `test` 为准。

## 上游接口形态（外部"依赖"）

| 上游 | 接入方式 | 风险 |
|---|---|---|
| 网易云音乐 | `NeteaseCloudMusicApi` 包（本地起调用，非公网服务） | 包版本与网易改版双重风险；接口可用性用 `has()` 探测 + 多路兜底（如 lyric_new→lyric、playlist_detail→playlist_track_all）。 |
| QQ 音乐 | 直接 fetch Web 端接口（`u.y.qq.com/cgi-bin/musicu.fcg` 等），逆向来源见 [qq-music-api.md](qq-music-api.md) | 无官方 API；接口曾整体不可用（2026-07-05），vkey/鉴权逻辑对 cookie 形态敏感。 |
| Open-Meteo / ip-api.com | 免 key 公共接口 | 天气电台专用，失败有本地兜底电台。 |
| GitHub Releases + 国内镜像 | 更新检查/下载 | 镜像列表配置在 package.json `simplemusic.update.mirrors`，支持 `{url}`/`{encodedUrl}` 模板。 |

## 环境要求

- Node 20+（`@types/node` ^20；server 代码使用全局 `fetch`、`AbortSignal.timeout`）。
- 平台：macOS 优先（开发机），Windows 完整支持（含桌面歌词中键、壁纸注入等 win32 专属能力），Linux 仅理论可跑（更新资源选择有 AppImage/deb 分支但未打包）。
