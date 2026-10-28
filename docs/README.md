# 文档导航

从 [项目首页](../README.md) 获取安装包与功能介绍；准备贡献代码时先读 [协作规范](../CONTRIBUTING.md) 与 [仓库代理指南](../AGENTS.md)。版本与依赖以 `package.json` 为准，下面的“当前实现”文档应随代码更新。

## 产品与界面必读

| 阅读顺序 | 文档负责什么 |
|---|---|
| [产品理念](../PRODUCT.md) | 用户已经明确的诉求、产品任务与取舍，避免后续反复解释 |
| [设计准则](../DESIGN.md) | 文字与图标、信息层级、共用样式、悬停与动效、参考规范如何落地，以及完成条件 |
| [界面现状](ui-ux.md) | 当前应用全貌、入口和共用组件、已实现与未验收的边界 |

这三份是持续维护的工作依据，不是全应用已完成验收的声明。带日期的方案和截图保留当时证据；与现行文档冲突时，先核对代码，再更新当前说明。

## 当前实现

| 需要了解 | 文档 |
|---|---|
| 进程、数据流、启动顺序 | [架构总览](architecture.md) |
| 文件与模块归属 | [目录结构](directory-structure.md)、[主进程](modules/electron-main.md)、[API Server](modules/server.md)、[渲染层](modules/renderer.md)、[悬浮窗](modules/overlays.md) |
| 播放、跨源兜底与缓存 | [播放系统](playback-system.md) |
| 独立后台播放、游戏模式释放 UI 与重连 | [独立播放宿主](playback-host.md) |
| 依赖、开发环境 | [技术栈](tech-stack.md) |
| 启动、渲染、内存与性能验收 | [性能与界面维护](performance.md) |
| 应用聚合与平台歌单管理的边界 | [渲染层](modules/renderer.md)、[职责收敛的决定记录](specs/2026-10-18-playlist-boundaries.md) |
| 版本、打包、签名和发布 | [构建与发布](build-and-release.md) |
| 上游接口 | [网易云接口笔记](netease-music-api.md)、[QQ 接口笔记](qq-music-api.md) |

## 最近开发与验证

当前工作区包含未发布的队列与库控件改动；下表说明阶段证据，不代替发布状态或最终视觉验收。

| 需要了解 | 文档 |
|---|---|
| 下载/伴奏队列的现行实现、分阶段截图与验证边界 | [任务队列验收](reviews/2026-10-28-task-queue-verification.md)、[设计决策](specs/2026-10-28-task-queue-bubble-design.md) |
| 伴奏、本地、离线的共用控件及最新鼠标验收缺口 | [音乐库与任务操作统一](reviews/2026-10-28-library-controls.md) |

## 版本与历史资料

以下记录对应当时的源码与验证，不能直接当作当前缺陷清单或现行规范。旧歌单双向同步已经收敛为应用歌单与平台直接管理，旧动效总开关也已改为独立项；当前行为先查上面的现行文档。

| 需要追溯 | 文档 |
|---|---|
| 设置密度、跨页视觉与主动审查的早期反馈 | [2026-10-23 界面审查](reviews/2026-10-23-ui-visual-audit.md) |
| 2.4.1 当时的动效控制方案（已演变） | [动效阶段记录](reviews/2.4.1-motion-settings.md) |
| 2.3.0 整合范围、深审修复与验收边界 | [2.3.0 审查记录](reviews/2.3.0-code-review.md) |
| 2.3.1 开发中的全面检查、优化与待验事项 | [2.3.1 审查记录](reviews/2.3.1-code-review.md) |
| 2.3.4 整体代码审查与按优先级修复 | [2.3.4 审查记录](reviews/2.3.4-code-review.md) |
| 发行说明与发布准备 | [2.5.1](release-notes-2.5.1.md)、[2.5.0](release-notes-2.5.0.md)、[2.4.0](release-notes-2.4.0.md)、[2.3.6](release-notes-2.3.6.md)、[2.3.5](release-notes-2.3.5.md)、[2.3.4](release-notes-2.3.4.md)、[2.3.3](release-notes-2.3.3.md)、[2.3.2](release-notes-2.3.2.md)、[2.3.1](release-notes-2.3.1.md)、[2.3.0](release-notes-2.3.0.md) |
| 2.5.0 本地验收、依赖审计与待发布事项 | [发布准备记录](reviews/2.5.0-release-preparation.md) |
| 2.4.0 应用歌单四源展示、真实本地播放与页面截图 | [应用歌单验收](reviews/2.4.0-app-playlist-launch.md) |
| 2.4.0 网易云、QQ 收听上报与官方统计验证边界 | [听歌记录需求](specs/2026-10-12-listening-records-2.4.0.md) |
| 2.4.0 当前架构核对与分阶段重构范围 | [架构梳理与重构范围](specs/2026-10-12-simple-music-2.4.0-refactor-scope.md) |
| 2.4.0 现有界面精修、前后截图和验收范围 | [界面调整对照](reviews/2.4.0-ui-refinement.md) |
| 2.4.0 库缓存、拖动、滚动条与内容延展布局 | [库与探索交互验收](reviews/2.4.0-library-experience.md) |
| 2.4.0 探索横排、统一滚动条与 Apple 横向浏览 | [横排与整体风格验收](reviews/2.4.0-rail-integrated-scrollbar.md) |
| 2.4.0 漫游排序与滚动请求对照 | [漫游与滚动性能验收](reviews/2.4.0-roam-scroll-performance.md) |
| 2.4.0 QQ 最近歌曲、每日30首、红心与验证缺口 | [QQ账号与推荐验收](reviews/2.4.0-qq-platform-parity.md) |
| 2.4.0 曾实现的歌单双向同步（已被职责收敛取代） | [歌单双向同步验收](reviews/2.4.0-playlist-sync-workflow.md) |
| 2.4.0 歌单数量口径、云盘差额与同步测试边界 | [歌单数量验收](reviews/2.4.0-playlist-count-consistency.md)、[同步测试矩阵](reviews/2.4.0-playlist-sync-test-matrix.md) |
| 2.4.0 QQ 红心80105修复与真实账号验证 | [签名加密协议验收](reviews/2.4.0-qq-favorite-protocol.md) |
| Apple Music 的设计选择与验收边界 | [Apple Music 接入记录](specs/2026-09-17-apple-music-integration.md) |

`release-notes-*.md` 是对应版本的发行说明。`specs/`、`superpowers/`、带日期的路线图和问题记录保存当时的设计与验证结果；其中的命令、能力和测试数量可能已经变化，判断当前行为时先查上述现行文档和代码。
