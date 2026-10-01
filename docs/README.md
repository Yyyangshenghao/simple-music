# 文档导航

从 [项目首页](../README.md) 获取安装包与功能介绍；准备贡献代码时先读 [协作规范](../CONTRIBUTING.md) 与 [仓库代理指南](../AGENTS.md)。版本与依赖以 `package.json` 为准，下面的“当前实现”文档应随代码更新。

| 需要了解 | 文档 |
|---|---|
| 进程、数据流、启动顺序 | [架构总览](architecture.md) |
| 文件与模块归属 | [目录结构](directory-structure.md)、[主进程](modules/electron-main.md)、[API Server](modules/server.md)、[渲染层](modules/renderer.md)、[悬浮窗](modules/overlays.md) |
| 播放、跨源兜底与缓存 | [播放系统](playback-system.md) |
| 依赖、开发环境 | [技术栈](tech-stack.md) |
| 版本、打包、签名和发布 | [构建与发布](build-and-release.md) |
| 上游接口 | [网易云接口笔记](netease-music-api.md)、[QQ 接口笔记](qq-music-api.md) |
| Apple Music 的设计选择与验收边界 | [Apple Music 接入记录](specs/2026-09-17-apple-music-integration.md) |

`release-notes-*.md` 是对应版本的发行说明。`specs/`、`superpowers/`、带日期的路线图和问题记录保存当时的设计与验证结果；其中的命令、能力和测试数量可能已经变化，判断当前行为时先查上述现行文档和代码。
