# Simple Music 仓库协作指南

本文件只记录仓库事实与改动边界。当前实现以代码和 `package.json` 为准；文档入口见 [docs/README.md](docs/README.md)，协作、提交与 PR 规则见 [CONTRIBUTING.md](CONTRIBUTING.md)。日期命名的方案和问题记录是历史资料，不应代替现行实现。

## 项目与入口

Simple Music 是 Electron + React + TypeScript 桌面播放器。在线平台有网易云、QQ、Apple Music；本地文件是第四种 `MusicSource`，不属于在线 `ProviderId`。

| 目录 | 职责 | 先读 |
|---|---|---|
| `electron/` | 主进程、IPC、preload、窗口、登录与平台能力 | [主进程说明](docs/modules/electron-main.md) |
| `server/` | 主进程内嵌的 HTTP API、音源封装、代理与缓存 | [Server 说明](docs/modules/server.md) |
| `src/` | React 主窗口、providers、stores、hooks、业务逻辑 | [渲染层说明](docs/modules/renderer.md) |
| `overlays/` | 桌面歌词、壁纸、迷你条的独立渲染入口 | [悬浮窗说明](docs/modules/overlays.md) |

数据请求由渲染层经 `src/lib/api.ts` 到本地 `/api/*`；窗口和系统控制经 preload 暴露的桥到 IPC。Apple Music 的受保护播放在独立官网会话中运行，路径与音频引擎不同；详见 [架构](docs/architecture.md) 和 [播放系统](docs/playback-system.md)。

## 常用命令与验收

```bash
npm ci                         # 按 lockfile 安装
npm run dev                    # Electron 开发模式，API 随主进程启动
npm run server:dev             # 仅启动 API，默认 127.0.0.1:35530
npm run typecheck              # Node/Electron 与渲染层两套 tsconfig
npm test                       # 全量 Vitest
npx vitest run src/lib/stack-pool.test.ts  # 单文件测试示例
npm run build                  # 构建到 out/，不生成安装包
```

没有 lint 命令。逻辑改动使用源码同目录的 `*.test.ts` / `*.test.tsx`；修复缺陷先写能复现的回归用例。提交前完成 `npm run typecheck && npm test`；UI、窗口、播放或登录改动还需用 `npm run dev` 检查受影响流程。安装包命令与发布门槛见 [构建与发布](docs/build-and-release.md)。

## 修改边界

- TypeScript 沿用两空格、单引号、无分号和现有 ESM 写法；组件样式用同目录 CSS Modules，复用 `src/styles/tokens.css` 与 `src/lib/motion-presets.ts`。不要顺带格式化无关文件。
- `Track.duration` 为毫秒；player store 的 `position` / `duration` 为秒。`Track.id`、`Playlist.id` 是 `unknown`，比较或拼接前先 `String()`。
- 在线实体按自身 `source` 选 `providerFor(source)` 能力或兼容层 `serviceFor(source)`；本地文件走本地服务。`ProviderId` 是 `netease` / `qq` / `apple`；`MusicSource` 另含 `local`。新增来源分支必须显式考虑本地文件。
- Apple Music 使用独立 MusicKit 播放会话，不进入网易/QQ 的跨源兜底、直链代理或离线音频缓存；其他平台失败也不能静默换成 Apple。歌词可以独立从已启用平台匹配同曲补位。
- 异步页面请求、切歌和缓存更新要丢弃过期响应；跨源或登录态变化时尤其检查会话序号、取消信号和平台参与状态。
- 本地 API URL 不能再送入 `/api/audio` 或封面代理；本地曲目按索引 ID 读取。新增 API、代理或 IPC 时保持 `server/lib/security.ts` 的 Origin/token/上游 URL 边界及 `src/types/ipc.ts` 契约。
- 全屏 WebGL 场景在单窗口内避免并跑，换掉的 Three.js 资源应释放；模块级缓存要有明确上限。

## 提交、PR 与发布

固定分支流向为 `feature/*` → `dev/X.Y.Z` → `master` → `vX.Y.Z` → Release。每个版本使用一个明确的 dev，新任务从所属 dev 创建 feature，功能和修复都先合回 dev；不得默认从 master 创建普通工作分支或跳过 dev。已有旧命名分支不自动重命名，先确认版本归属。英文 Conventional Commit 类型加中文主题；PR 写明范围、目标版本、原因与验证，UI 变更附截图或录屏。feature → dev 使用 Squash merge，dev → master 使用 Merge commit，保留集成及发布历史；已共享的 dev/master 不 rebase 或强推。详细规则以 [CONTRIBUTING.md](CONTRIBUTING.md) 为准。

本仓库中“推送”“提交并推送”“可以发了”默认指完整版本升级，按 [构建与发布 §0](docs/build-and-release.md) 执行：确认版本 dev 与发布范围，完成 feature 集成，在 dev 更新 `package.json`、`package-lock.json` 和发行说明，验证并形成独立发布元数据提交，经发布 PR 合入 master，再对合并后的 master 提交创建 annotated tag；推送 tag 后等待 Release 工作流并核对产物。发布授权包含上述 PR、合并与 tag 操作，不得先从 dev 发稳定版再补合主分支。用户明确要求“只推代码”“只推分支”“推送 feature/dev 分支”“不要升级版本”或“不要打 tag”时仅同步指定分支。

开发分支构建只用于验证或明确标识的预发布；稳定版本默认只能从 master 上已验收的提交打 tag，并构建该 tag 的固定源码。发布前告知目标版本及公开 tag/Release；版本冲突、同名 tag 或范围不明的工作区改动应停止，已推送 tag 不得改写。旧版本隔离补丁必须按 §0.8 明确授权并记录基准；不能擅自绕过主干发布流程。CI 和分支保护的实际状态以仓库配置为准，不能将文档要求宣称为已启用的自动门禁。
