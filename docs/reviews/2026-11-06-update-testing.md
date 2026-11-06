# 本地升级测试套件与 beta 更新通道

目标开发版本 `dev/2.7.0`，工作分支 `feature/windows-install-flow`。仓库版本仍为 2.6.2，未提交、推送、打 tag 或公开发布。维护者自行操作安装窗口，本次没有启动播放器、安装或卸载应用。

## 本地测试套件

入口见 [`scripts/release/windows-update-test/README.md`](../../scripts/release/windows-update-test/README.md)，实际套件为忽略目录 `dist/update-test/kit`。

- 正式旧包从 [v2.6.2 Release](https://github.com/Yyyangshenghao/simple-music/releases/tag/v2.6.2) 下载，核对官方资产 SHA-256 `652b36131458def1d42de68a70cfdc7bbd25a14ba621972afddbfe21187ecb87`。
- 测试构建只在 Vite 的 package.json 加载与 electron-builder 元数据中覆盖版本，关于页、更新 API、程序资源和安装器版本均为 2.7.0，源码版本文件不变。
- PowerShell 本地更新源只绑定 127.0.0.1，提供固定清单、固定安装包和状态/停止入口；不暴露任意目录。启动器仅对测试进程指定清单、禁用镜像展开，拒绝与运行中的播放器混用，并检查是否误用另一套测试服务。
- `check.mjs` 实际运行服务，完整下载约 141 MB 的测试 Setup 并校验长度及摘要，验证其他文件路径返回 404，最后停止服务。未执行安装包。
- 提供两轮基于 VM 快照的手工清单：原始 2.6.2 → 手动 Setup，以及恢复快照后原始 2.6.2 → 应用内下载/静默更新。每轮检查版本、设置、额外文件、快捷方式和卸载；旧目录的卸载器入口单独验收。

测试包缺少生产 VMP 签名，不代表 Apple Music DRM 的发布验收。没有在本机检测到 Windows Sandbox 入口，也没有配置或创建虚拟机；真实升级和卸载由维护者在一次性 VM 执行。

## 更新通道

按维护者要求，正式版只接收更高正式版；beta/rc 接收更高预发版或正式版。同号正式版高于预发版，不降级。

- 正式版仍请求 GitHub latest；预发版查询最近 100 条发布记录并按完整版本排序，拒绝草稿和无效版本。接口约定参照 [GitHub Releases API](https://docs.github.com/en/rest/releases/releases)。
- 版本身份、下载 tag 和任务交接保留 `-beta.N` / `-rc.N`。备用清单及自定义测试源也执行通道规则，不能用 `updateAvailable: true` 强制正式版进入 beta 或降级。
- API 失败时沿用正式版备用清单，此时只能保证检查正式版，不能保证发现 beta。
- 已安装包的启动清理保留 beta/rc 后缀，正确区分已安装 beta、更高 beta 与同号正式版。预发版不匹配仅按主版本命名的旧补丁。
- 尚不含新逻辑的已发布 beta 需要先手动安装一次包含新逻辑的版本，不会凭空改变旧客户端行为。

## 验证结果

- 先新增通道回归，确认旧代码 14 项中 11 项失败；安装包后缀/清理的两项新增回归也在修复前失败。
- 修复后 `npm run typecheck` 通过；全量 442 个测试文件通过，4193 项通过、7 项跳过。
- 独立 2.7.0 应用构建与 Windows NSIS 打包通过，已将新通道逻辑编入套件。
- 本地 HTTP 服务检查通过，包括实际完整下载及摘要校验，无安装行为。
- 没有执行真实 beta → beta 安装或公开 Release。此行为由自动化响应夹具验证，2.6.2 → 2.7.0 套件不能替代该平台实测。
